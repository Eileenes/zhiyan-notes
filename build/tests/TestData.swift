// 数据层独立测试。跑法：
//   swiftc -O build/Data.swift build/tests/TestData.swift -o /tmp/testdata && /tmp/testdata
// 不依赖壳，先把地基测通再往上接。

import Foundation
import SQLite3

var failures = 0
var checks = 0

func check(_ label: String, _ pass: Bool, _ detail: String = "") {
    checks += 1
    if pass {
        print("  ✅ \(label)\(detail.isEmpty ? "" : " — \(detail)")")
    } else {
        failures += 1
        print("  ❌ \(label)\(detail.isEmpty ? "" : " — \(detail)")")
    }
}

func section(_ t: String) { print("\n\(t)") }

// swiftc 多文件编译时只有 main.swift 允许顶层表达式，
// 所以整个测试体包进 @main，而不是改名叫 main.swift。
@main
struct Runner {
static func main() throws {

// MARK: - 建库

let tmp = NSTemporaryDirectory() + "zy-test-\(UUID().uuidString).db"
let store = DataStore(path: tmp)

section("① 建库")
let tables = store.countForTest("SELECT count(*) c FROM sqlite_master WHERE name LIKE 'notes%'")
check("表与索引已建立", tables >= 3, "\(tables) 个对象")
let ftsOK = store.probeTest("SELECT count(*) FROM notes_fts_trigram") >= 0
check("FTS5 trigram 表可查询", ftsOK)
check("FTS5 unigram 表可查询", store.probeTest("SELECT count(*) FROM notes_fts_unigram") >= 0)

// MARK: - 写入

section("② 写入与读回")

let samples: [(String, String, [String])] = [
    ("小区口包子店租金要翻倍，老板大概撑不过这个冬天", "voice", ["念头", "早餐店"]),
    ("今天下雨了，地铁站里全是伞", "text", []),
    ("跟李彦在望京SOHO楼下那家云南米线聊了二十分钟", "voice", ["李彦"]),
    ("深夜想了很久，咖啡店到底该卖什么", "text", ["咖啡", "生意"]),
    ("烘焙豆子这事真不能省，同一支豆子烘深浅完全是两个东西", "voice", ["咖啡", "烘焙"]),
]

let base = Int(Date().timeIntervalSince1970 * 1000)
for (i, s) in samples.enumerated() {
    try store.save(id: "n\(i+1)", text: s.0, source: s.1, tags: s.2,
               summary: nil, processState: "done")
    // 让它们落在过去几天，时间线才有层次
    store.setCreatedAt(id: "n\(i+1)", ms: base - i * 86_400_000)
}

let all = store.loadAll()
check("读回 5 条", all.count == 5, "实际 \(all.count)")
check("字段完整", (all.first?["raw"] as? String)?.contains("包子") == true)
check("标签已解析成数组", (all.first?["tags"] as? [String])?.count == 2)

// MARK: - 逐字空格化

section("③ 逐字空格化（中文检索的地基）")
check("汉字拆开", DataStore.spacedForIndex("包子店") == "包 子 店",
      "→ '\(DataStore.spacedForIndex("包子店"))'")
check("西文不拆", DataStore.spacedForIndex("iPhone") == "iPhone",
      "→ '\(DataStore.spacedForIndex("iPhone"))'")
check("中英混排", DataStore.spacedForIndex("用SOHO的楼") == "用 SOHO 的 楼",
      "→ '\(DataStore.spacedForIndex("用SOHO的楼"))'")

// MARK: - 检索

section("④ 中文检索（双表分流）")

struct Case { let q: String; let expect: Int; let note: String }
let cases: [Case] = [
    // 2 字 —— trigram 失效，全靠 unigram
    .init(q: "包子", expect: 1, note: "2字，仅 unigram 能命中"),
    .init(q: "下雨", expect: 1, note: "2字"),
    .init(q: "咖啡", expect: 2, note: "2字，命中 2 条"),
    .init(q: "李彦", expect: 1, note: "2字，专名"),
    .init(q: "米线", expect: 1, note: "2字"),
    .init(q: "SOHO", expect: 1, note: "西文 2 段"),
    // 1 字 —— 最极端的短查询
    .init(q: "雨", expect: 1, note: "1字，只在「今天下雨了」里"),
    // 3 字以上 —— 双表都能命中
    .init(q: "包子店", expect: 1, note: "3字"),
    .init(q: "咖啡店", expect: 1, note: "3字"),
    .init(q: "烘焙", expect: 1, note: "2字，标签+正文同一条"),
    // 无结果
    .init(q: "量子力学", expect: 0, note: "无结果"),
    // 多词 AND
    .init(q: "咖啡 豆子", expect: 1, note: "两词都出现"),
    .init(q: "咖啡 包子", expect: 0, note: "AND 不应放宽成 OR"),
]

for c in cases {
    let hits = store.search(c.q)
    check("「\(c.q)」→ \(c.expect) 条", hits.count == c.expect,
          "实际 \(hits.count) 条 · \(c.note)")
}

// MARK: - 更新与软删除

section("⑤ 更新与删除")
try store.save(id: "n2", text: "今天晴了，地铁站里全是伞", source: "text", tags: [], processState: "done")
let afterUpdate = store.search("下雨")
check("更新后旧词搜不到", afterUpdate.count == 0, "实际 \(afterUpdate.count)")
check("更新后新词搜得到", store.search("晴了").count == 1)

try store.delete(id: "n5")
check("软删除后不出现在列表", store.loadAll().count == 4, "实际 \(store.loadAll().count)")
check("软删除后搜不到", store.search("烘焙").count == 0, "实际 \(store.search("烘焙").count)")

// MARK: - 索引重建

section("⑥ 索引可重建")
store.rebuildIndex()
check("重建后搜索仍正常", store.search("咖啡").count == 1, "实际 \(store.search("咖啡").count)")
check("重建后软删除的不复活", store.search("烘焙").count == 0)

// MARK: - 导出

section("⑦ 导出")
let json = store.exportJSON()
let jsonObj = (try? JSONSerialization.jsonObject(with: Data(json.utf8))) as? [String: Any]
check("JSON 可解析", jsonObj != nil)
// 有意的不对称：JSON 导出**全部**记录（含软删除，带 deleted 标记），
// 因为「随时能带走」意味着连删掉的也能还原；Markdown 是给人读的，只含未删除的。
check("JSON 含全部 5 条（含已删除的 1 条）", (jsonObj?["count"] as? Int) == 5,
      "实际 \(jsonObj?["count"] ?? -1)")
check("JSON notes 数组 5 条", ((jsonObj?["notes"] as? [[String: Any]])?.count) == 5,
      "实际 \((jsonObj?["notes"] as? [[String: Any]])?.count ?? -1)")
check("JSON 字段完整", (jsonObj?["notes"] as? [[String: Any]])?.first?["raw_text"] != nil)
check("JSON 保留 deleted 标记",
      ((jsonObj?["notes"] as? [[String: Any]])?.contains { ($0["deleted"] as? Bool) == true }) == true)

let md = store.exportMarkdown()
check("Markdown 有标题", md.hasPrefix("# 只言"))
check("Markdown 分隔线", md.contains("---\n\n"))
check("Markdown 含原文", md.contains("包子店"))
check("Markdown 条数正确", md.contains("共 4 条"))

// MARK: - 统计

section("⑧ 统计")
let st = store.stats()
check("总数 4", st["total"] == 4, "实际 \(st["total"] ?? -1)")
check("字数 > 0", (st["chars"] ?? 0) > 0, "实际 \(st["chars"] ?? -1)")

// MARK: - 空值绑定（回归：曾把字面量 "nil" 写进库）

section("⑨ 空值不得写成字符串 nil")
try store.save(id: "n9", text: "空值回归用例", source: "text",
           summary: nil, audioPath: nil, language: nil, processState: "done")
let raw9 = store.dumpRowForTest(id: "n9")
check("summary 是真 NULL 不是字符串 nil", raw9["summary"] is NSNull,
      "实际 \(String(describing: raw9["summary"]))")
check("audio_path 是真 NULL", raw9["audio_path"] is NSNull,
      "实际 \(String(describing: raw9["audio_path"]))")
check("language 是真 NULL", raw9["language"] is NSNull,
      "实际 \(String(describing: raw9["language"]))")
check("loadAll 不返回字符串 nil",
      store.loadAll().allSatisfy { !($0["summary"] is String && ($0["summary"] as! String) == "nil") })

// Regression coverage for real failure paths and retrieval boundaries.
section("⑩ 花园版本回归")
let regression = DataStore(path: ":memory:")
try regression.save(id: "sea", text: "海上日出", source: "text")
check("上海不误中海上", regression.search("上海").isEmpty)
try regression.save(id: "across", text: "上", source: "text", tags: ["海"])
check("词组不能跨正文与标签拼接", regression.search("上海").isEmpty)
try regression.save(id: "shanghai", text: "上海旅行", source: "text", tags: ["旅行"])
check("准确词组仍能命中", regression.search("上海").count == 1)
try regression.save(id: "repeat", text: "哈", source: "text")
check("重复字必须完整出现", regression.search("哈哈").isEmpty)
try regression.save(id: "voice", text: "", source: "voice", audioPath: "/tmp/fixture.m4a", durationMs: 12345, processState: "pending")
try regression.updateText(id: "voice", text: "补充录音文字", tags: ["语音"])
let edited = regression.get(id: "voice")!
check("编辑保留原始录音", edited["audio"] as? String == "/tmp/fixture.m4a")
check("编辑保留时长", edited["dur"] as? Double == 12.345)
try regression.delete(id: "voice")
check("删除从检索排除", regression.search("补充").isEmpty)
try regression.restore(id: "voice")
check("撤销删除恢复检索", regression.search("补充").count == 1)
check("单条导出不带其他记忆", !regression.exportMarkdown(id: "voice").contains("海上日出"))

let paged = DataStore(path: ":memory:")
for i in 0..<230 {
    let id = String(format: "p%03d", i)
    try paged.save(id: id, text: "花园 " + (i == 0 ? "唯一记忆" : "日常记录"), source: "text")
    paged.setCreatedAt(id: id, ms: base)
}
var pageIDs: [String] = []
var page = paged.page()
while !page.isEmpty {
    pageIDs += page.compactMap { $0["id"] as? String }
    let last = page.last!
    page = paged.page(before: last["created_at"] as? Int, beforeID: last["id"] as! String)
}
check("同一时间分页不重不漏", pageIDs.count == 230 && Set(pageIDs).count == 230)
check("多词先求交集再截取，保留长列表末尾命中", paged.search("花园 唯一记忆").count == 1)

try paged.save(id: "filtered", text: "花园语音", source: "voice")
check("来源筛选在限制结果数之前执行", paged.search("花园", source: "voice").count == 1)
let unopened = DataStore(path: tmp + "/missing/notes.db")
check("打不开数据库时保留初始化错误", unopened.initializationError != nil)
do {
    _ = try unopened.save(text: "不能假装空库可写", source: "text")
    check("未打开的数据库拒绝保存", false)
} catch { check("未打开的数据库拒绝保存", true) }

var failureDB: OpaquePointer?
check("打开故障注入连接", sqlite3_open(tmp, &failureDB) == SQLITE_OK)
check("安装写入失败触发器", sqlite3_exec(failureDB, "CREATE TRIGGER fail_save BEFORE INSERT ON notes BEGIN SELECT RAISE(ABORT, 'simulated disk failure'); END;", nil, nil, nil) == SQLITE_OK)
do {
    _ = try store.save(id: "failed", text: "不能假装保存成功", source: "text")
    check("写失败必须抛错", false)
} catch { check("写失败必须抛错", true) }
check("失败记录未落库", store.get(id: "failed") == nil)
sqlite3_close(failureDB)

// MARK: - 结论

try? FileManager.default.removeItem(atPath: tmp)
print("\n" + String(repeating: "─", count: 52))
if failures == 0 {
    print("全部通过：\(checks)/\(checks)")
} else {
    print("\(failures) 项失败 / 共 \(checks) 项")
}
exit(failures == 0 ? 0 : 1)

}
}
