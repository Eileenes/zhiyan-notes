import Foundation

/// Pure (Foundation-only) web security policy for the Apple shells, kept out of
/// shell.swift so it can be unit-tested on any platform (build/tests/TestWebPolicy.swift).
enum WebPolicy {
    /// Script sources that defeat the point of the CSP.
    static let bannedScriptSources: Set<String> = [
        "'unsafe-inline'", "'unsafe-eval'", "'unsafe-hashes'", "'wasm-unsafe-eval'",
        "'strict-dynamic'", "*", "data:", "blob:", "filesystem:", "file:", "http:", "https:",
    ]

    /// `content` of every `<meta http-equiv="Content-Security-Policy">` that
    /// appears in <head> before the first <script>.
    static func metaPolicies(in html: String) -> [String] {
        let head = html.range(of: "<script", options: .caseInsensitive).map { String(html[..<$0.lowerBound]) } ?? html
        let tag = try! NSRegularExpression(pattern: "<meta\\b[^>]*>", options: [.caseInsensitive])
        let attr = try! NSRegularExpression(
            pattern: "([a-zA-Z-]+)\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)')", options: [])
        var out: [String] = []
        let ns = head as NSString
        for m in tag.matches(in: head, range: NSRange(location: 0, length: ns.length)) {
            let t = ns.substring(with: m.range) as NSString
            var attrs: [String: String] = [:]
            for a in attr.matches(in: t as String, range: NSRange(location: 0, length: t.length)) {
                let name = t.substring(with: a.range(at: 1)).lowercased()
                let r = a.range(at: 2).location != NSNotFound ? a.range(at: 2) : a.range(at: 3)
                attrs[name] = t.substring(with: r)
            }
            if attrs["http-equiv"]?.lowercased() == "content-security-policy", let c = attrs["content"] {
                out.append(c.replacingOccurrences(of: "&#39;", with: "'").replacingOccurrences(of: "&apos;", with: "'"))
            }
        }
        return out
    }

    /// Source list of the directive governing scripts (script-src, else default-src).
    static func scriptSources(_ policy: String) -> [String]? {
        var directives: [String: [String]] = [:]
        for part in policy.split(separator: ";") {
            let tokens = part.split(whereSeparator: { $0 == " " || $0 == "\t" || $0 == "\n" }).map { String($0).lowercased() }
            guard let name = tokens.first, directives[name] == nil else { continue } // first wins (CSP spec)
            directives[name] = Array(tokens.dropFirst())
        }
        return directives["script-src"] ?? directives["default-src"]
    }

    /// A policy is acceptable when its script sources are non-empty and contain
    /// nothing from `bannedScriptSources` and no host/URL sources.
    static func isSafeScriptPolicy(_ policy: String) -> Bool {
        guard let sources = scriptSources(policy), !sources.isEmpty else { return false }
        return sources.allSatisfy { s in
            !bannedScriptSources.contains(s) && (s.hasPrefix("'") || s == "'none'")
        }
    }

    /// Multiple CSPs are all enforced (intersection), so one safe policy suffices.
    static func pageIsProtected(_ html: String) -> Bool {
        metaPolicies(in: html).contains(where: isSafeScriptPolicy)
    }

    enum Navigation: Equatable { case allow, openExternally(URL), cancel }

    /// Only the bundled UI may load in the web view; web links open in the
    /// system browser; everything else is cancelled.
    static func decide(_ url: URL?, webRoot: URL) -> Navigation {
        guard let url, let scheme = url.scheme?.lowercased() else { return .cancel }
        switch scheme {
        case "file":
            let root = webRoot.standardizedFileURL.resolvingSymlinksInPath().path
            let path = url.standardizedFileURL.resolvingSymlinksInPath().path
            return path == root || path.hasPrefix(root.hasSuffix("/") ? root : root + "/") ? .allow : .cancel
        case "about":
            return url.absoluteString == "about:blank" ? .allow : .cancel
        case "http", "https", "mailto":
            return .openExternally(url)
        default:
            return .cancel
        }
    }
}
