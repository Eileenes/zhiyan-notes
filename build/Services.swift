import Foundation
import Security
import CryptoKit

@_silgen_name("zy_core_call") private func zyCoreCall(_ path: UnsafePointer<CChar>, _ request: UnsafePointer<CChar>) -> UnsafeMutablePointer<CChar>?
@_silgen_name("zy_core_free") private func zyCoreFree(_ pointer: UnsafeMutablePointer<CChar>)

enum CoreServices {
  static let operations: Set<String> = ["deviceID", "providersValidate", "servicesGet", "providersSave", "providerTest", "aiEnqueue", "aiRun", "aiRetry", "syncAuth", "syncBind", "syncRun", "syncLogout", "syncStatus", "syncConflicts", "syncResolve", "audioDownload", "page", "get", "search", "save", "update", "delete", "restore", "load", "stats"]
  static func call(path: String, request: [String: Any]) throws -> Any {
    let data = try JSONSerialization.data(withJSONObject: request)
    let input = String(data: data, encoding: .utf8)!
    let output = path.withCString { p in input.withCString { q in zyCoreCall(p, q) } }
    guard let output else { throw StoreError.failed("服务未返回结果") }
    defer { zyCoreFree(output) }
    let result = try JSONSerialization.jsonObject(with: Data(String(cString: output).utf8)) as? [String: Any]
    guard result?["ok"] as? Bool == true else { throw StoreError.failed(result?["error"] as? String ?? "服务请求失败") }
    return result?["data"] ?? NSNull()
  }
}

enum Credentials {
  static func handle(_ request: [String: Any], database: String) throws -> Any {
    let key = request["key"] as? String ?? ""
    guard key.count < 150, key.hasPrefix("provider.") || key.hasPrefix("sync.") || key == "gateway.access" else { throw StoreError.failed("无效的凭据名称") }
    let scope = SHA256.hash(data: Data(database.replacingOccurrences(of: NSHomeDirectory(), with: "~").utf8)).map { String(format: "%02x", $0) }.joined()
    let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: "com.duketao.zhiyan.credentials." + scope,
      kSecAttrAccount as String: key]
    switch request["op"] as? String {
    case "secretGet":
      var read = query
      read[kSecReturnData as String] = true
      read[kSecMatchLimit as String] = kSecMatchLimitOne
      var result: CFTypeRef?
      let status = SecItemCopyMatching(read as CFDictionary, &result)
      if status == errSecItemNotFound { return "" }
      guard status == errSecSuccess, let data = result as? Data else { throw StoreError.failed("无法读取系统安全存储（\(status)）") }
      return String(data: data, encoding: .utf8) ?? ""
    case "secretSet":
      guard let value = request["value"] as? String, !value.isEmpty, value.count <= 8192 else { throw StoreError.failed("凭据不能为空或过长") }
      let fields: [String: Any] = [kSecValueData as String: Data(value.utf8)]
      var status = SecItemUpdate(query as CFDictionary, fields as CFDictionary)
      if status == errSecItemNotFound {
        var added = query.merging(fields) { _, new in new }
        added[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        status = SecItemAdd(added as CFDictionary, nil)
      }
      guard status == errSecSuccess else { throw StoreError.failed("无法保存到系统安全存储（\(status)）") }
      return true
    case "secretDelete":
      let status = SecItemDelete(query as CFDictionary)
      guard status == errSecSuccess || status == errSecItemNotFound else { throw StoreError.failed("无法移除凭据（\(status)）") }
      return true
    default: throw StoreError.failed("无效的凭据操作")
    }
  }
}

// The app owns secrets; Rust only receives a snapshot for the running gateway.
// No provider credential or gateway key is persisted in the shared database.
enum GatewayServices {
  private static let lock = NSLock()
  static func handle(_ request: [String: Any], database: String) throws -> Any {
    lock.lock()
    defer { lock.unlock() }
    let op = request["op"] as? String ?? ""
    func call(_ body: [String: Any]) throws -> Any { try CoreServices.call(path: database, request: body) }
    if op == "gatewayStatus" || op == "gatewayStop" { return try call(["op": op]) }
    #if os(macOS)
      func read(_ key: String) throws -> String {
        try Credentials.handle(["op": "secretGet", "key": key], database: database) as? String ?? ""
      }
      func write(_ key: String, _ value: String) throws {
        _ = try Credentials.handle(["op": "secretSet", "key": key, "value": value], database: database)
      }
      if op == "gatewayKey" { return try read("gateway.access") }
      if op == "gatewayRotate" {
        let previous = try read("gateway.access")
        let key = "zy_" + UUID().uuidString.replacingOccurrences(of: "-", with: "") + UUID().uuidString.replacingOccurrences(of: "-", with: "")
        try write("gateway.access", key)
        do { return try call(["op": op, "key": key]) }
        catch {
          if !previous.isEmpty { try? write("gateway.access", previous) }
          throw error
        }
      }
      guard op == "gatewayStart" else { throw StoreError.failed("无效的接口操作") }
      var key = try read("gateway.access")
      if key.isEmpty {
        key = "zy_" + UUID().uuidString.replacingOccurrences(of: "-", with: "") + UUID().uuidString.replacingOccurrences(of: "-", with: "")
        try write("gateway.access", key)
      }
      var body: [String: Any] = ["op": op, "config": request["config"] ?? [:], "key": key]
      let config = request["config"] as? [String: Any] ?? [:]
      if config["openai"] as? Bool != false {
        let services = try call(["op": "servicesGet"]) as? [String: Any] ?? [:]
        let providers = services["providers"] as? [[String: Any]] ?? []
        if let provider = providers.first(where: { $0["enabled"] as? Bool != false && $0["protocol"] as? String != "transcription" }),
           let id = provider["id"] as? String {
          body["provider"] = provider
          body["provider_key"] = try read("provider." + id)
        }
      }
      return try call(body)
    #else
      throw StoreError.failed("请在 Mac 或 Windows 版开启对外接口")
    #endif
  }
}
