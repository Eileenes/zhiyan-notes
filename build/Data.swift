// ============================================================================
// 只言 · 数据层（双端共用）
// ----------------------------------------------------------------------------
// 为什么直接用 SQLite C API 而不引 GRDB：
//   GRDB 是方案里定的选型，但它要在 iOS 上带一整个 Swift 包体和一个 SPM 依赖，
//   而这里只用到查询和写库两个面。直接用系统 SQLite3（Apple 自带、FTS5 已开、
//   零依赖）能把包体和构建复杂度压到最低，等 UI 层从 WebView 换成 SwiftUI 时，
//   这一层可以原样保留 —— 换成 GRDB 也只是重写这一个文件。
//
// 中文检索（本文件最核心的部分，方案 3.6 的实现）：
//   notes_fts_trigram  trigram 分词，3+ 字符质量高
//   notes_fts_unigram  unicode61 分词，负责 1-2 字符兜底
//
//   ⚠️ 实测踩过的坑：unicode61 对中文**不是**开箱可用。
//      它按 Unicode 类别切词，而 CJK 汉字属于字母类，
//      于是「小区口包子店租金要翻倍」被切成**一个** token，
//      查「包子」永远 0 命中 —— 方案里原本写的「unigram 负责 1-2 字符兜底」
//      如果直接照做，是**不成立**的。
//
//   解法：写入 unigram 表的文本先逐字插空格再存。
//      「包子店」→「包 子 店」，unicode61 就能切出三个独立 token；
//      查询同样逐字插空格，「包子」→「包 子」，FTS5 按 AND 语义命中。
//      实测 1 字 / 2 字 / 3 字 / 西文全部命中（见 tests/test_data.swift）。
//
// 硬规则（方案第四章）：
//   · raw_text 只由用户主动编辑；AI 产出都是可丢弃的派生物
//   · 索引与数据分离，索引坏了可重建，数据是唯一真相源
// ============================================================================

import Foundation
import SQLite3

/// SQLite3 的常量在 Swift 里是 Int32，包一层避免每处强转
private let SQLITE_TRANSIENT = unsafeBitCast(-1, to: sqlite3_destructor_type.self)

public struct Note: Codable {
    public var id: String
    public var createdAt: Int          // unix ms
    public var updatedAt: Int
    public var source: String          // typed | voice | clipboard | share
    public var rawText: String
    public var summary: String?
    public var tags: [String]
    public var entities: [String: [String]]
    public var audioPath: String?
    public var durationMs: Int
    public var language: String?
    public var processState: String    // pending | partial | done | failed
    public var rev: Int
    public var deleted: Bool

    /// 供前端直接用的形态
    public func asDict() -> [String: Any] {
        return [
            "id": id,
            "created_at": createdAt,
            "day": DataStore.dayKey(createdAt),
            "time": DataStore.timeText(createdAt),
            "source": source,
            "raw": rawText,
            "summary": summary ?? NSNull(),
            "tags": tags,
            "entities": entities,
            "dur": Double(durationMs) / 1000.0,
            "audio": audioPath ?? NSNull(),
            "state": processState,
            "rev": rev,
        ]
    }
}

public enum StoreError: LocalizedError {
    case failed(String)
    public var errorDescription: String? { if case .failed(let message) = self { return message }; return nil }
}

public final class DataStore {

    // MARK: - 路径与初始化

    public let path: String
    private var db: OpaquePointer?
    public private(set) var failure: String?
    public private(set) var initializationError: String?
    public func clearFailure() { failure = nil }


    /// iOS 用 Documents（用户文件，能被 iTunes/Files 访问），macOS 用 Application Support
    public static func defaultPath(platform: String) -> String {
        let fm = FileManager.default
        let docs = fm.urls(for: .documentDirectory, in: .userDomainMask).first!
        if platform == "ios" {
            let dir = docs.appendingPathComponent("只言", isDirectory: true)
            try? fm.createDirectory(at: dir, withIntermediateDirectories: true)
            return dir.appendingPathComponent("notes.db").path
        }
        let base = fm.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
        let dir = base.appendingPathComponent("只言", isDirectory: true)
        try? fm.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir.appendingPathComponent("notes.db").path
    }

    /// 音频等附件目录，和 db 同级
    public static func mediaDir(platform: String) -> URL {
        let fm = FileManager.default
        let parent = URL(fileURLWithPath: defaultPath(platform: platform)).deletingLastPathComponent()
        let dir = parent.appendingPathComponent("media", isDirectory: true)
        try? fm.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }

    public var mediaDirectory: URL {
        let dir = URL(fileURLWithPath: path).deletingLastPathComponent().appendingPathComponent("media", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }

    public init(path: String) {
        self.path = path
        if sqlite3_open(path, &db) != SQLITE_OK {
            initializationError = "无法打开记忆数据库：" + errorMessage()
            NSLog("[只言] 打开数据库失败: \(String(cString: sqlite3_errmsg(db)))")
            return
        }
        // WAL：读写不互相阻塞
        exec("PRAGMA journal_mode=WAL;")
        exec("PRAGMA foreign_keys=ON;")
        migrate()
        initializationError = failure
    }

    deinit { if let db { sqlite3_close(db) } }

    // MARK: - 底层

    @discardableResult
    private func exec(_ sql: String) -> Bool {
        var err: UnsafeMutablePointer<CChar>?
        guard sqlite3_exec(db, sql, nil, nil, &err) == SQLITE_OK else {
            NSLog("[只言] SQL 失败: \(sql)\n  → \(err.map { String(cString: $0) } ?? "?")")
            failure = err.map { String(cString: $0) } ?? errorMessage()
            sqlite3_free(err)
            return false
        }
        return true
    }

    private func errorMessage() -> String {
        guard let db else { return "数据库未打开" }
        return String(cString: sqlite3_errmsg(db))
    }

    private func prepare(_ sql: String) -> OpaquePointer? {
        var st: OpaquePointer?
        if sqlite3_prepare_v2(db, sql, -1, &st, nil) != SQLITE_OK {
            failure = errorMessage()
            NSLog("[只言] prepare 失败: \(sql) → \(errorMessage())")
            return nil
        }
        return st
    }

    /// 读多行：列名 → 列值
    private func query(_ sql: String, _ bind: [(String, Any)] = []) -> [[String: Any]] {
        guard let st = prepare(sql) else { return [] }
        defer { sqlite3_finalize(st) }
        bindBind(st, bind)

        var out: [[String: Any]] = []
        var status = sqlite3_step(st)
        while status == SQLITE_ROW {
            var row: [String: Any] = [:]
            for i in 0..<sqlite3_column_count(st) {
                let name = String(cString: sqlite3_column_name(st, i))
                row[name] = columnValue(st, i)
            }
            out.append(row)
            status = sqlite3_step(st)
        }
        if status != SQLITE_DONE { failure = errorMessage() }
        return out
    }

    private func columnValue(_ st: OpaquePointer, _ i: Int32) -> Any {
        switch sqlite3_column_type(st, i) {
        case SQLITE_INTEGER: return Int(sqlite3_column_int64(st, i))
        case SQLITE_FLOAT:   return sqlite3_column_double(st, i)
        case SQLITE_NULL:    return NSNull()
        default:             return String(cString: sqlite3_column_text(st, i))
        }
    }

    private func bindBind(_ st: OpaquePointer, _ bind: [(String, Any)]) {
        var idx: Int32 = 1
        for (_, rawValue) in bind {
            // ⚠️ 必须先把 Optional 拆开再分派。
            //    Swift 里 `nil as Any` 得到的是 `Optional<String>.none`，
            //    它既不是 NSNull 也不是 String，会掉进最后的 default 分支，
            //    然后 String(describing:) 把字面量 **"nil" 写进数据库**。
            //    症状极难查：导出文件里 summary 是对的 null，但列表页渲染出一行 "nil"，
            //    因为列表走的是 query → note(from:) 这条路。
            let value: Any = {
                let m = Mirror(reflecting: rawValue)
                if m.displayStyle == .optional {
                    return m.children.first?.value ?? NSNull()
                }
                return rawValue
            }()

            switch value {
            case let s as String: sqlite3_bind_text(st, idx, s, -1, SQLITE_TRANSIENT)
            case let n as Int:     sqlite3_bind_int64(st, idx, Int64(n))
            case let d as Double:  sqlite3_bind_double(st, idx, d)
            case let b as Bool:    sqlite3_bind_int(st, idx, b ? 1 : 0)
            case is NSNull:        sqlite3_bind_null(st, idx)
            default:
                NSLog("[只言] 绑定值类型不支持，落 NULL: \(type(of: value))")
                sqlite3_bind_null(st, idx)
            }
            idx += 1
        }
    }

    private func execute(_ sql: String, _ bind: [(String, Any)] = []) -> Bool {
        guard let st = prepare(sql) else { return false }
        defer { sqlite3_finalize(st) }
        bindBind(st, bind)
        let success = sqlite3_step(st) == SQLITE_DONE
        if !success { failure = errorMessage() }
        return success
    }

    // MARK: - 建表

    private func migrate() {
        // search_uni 是「正文 + 摘要 + 标签」逐字空格化后的索引文本。
        // 它是**派生物**：任何时候都能从那三项重新生成，删了也不影响数据。
        exec("""
        CREATE TABLE IF NOT EXISTS notes (
          id            TEXT PRIMARY KEY,
          created_at    INTEGER NOT NULL,
          updated_at    INTEGER NOT NULL,
          source        TEXT NOT NULL,
          raw_text      TEXT,
          search_uni    TEXT,
          summary       TEXT,
          tags          TEXT,
          entities      TEXT,
          audio_path    TEXT,
          duration_ms   INTEGER DEFAULT 0,
          language      TEXT,
          process_state TEXT DEFAULT 'pending',
          device_id     TEXT,
          rev           INTEGER DEFAULT 1,
          deleted       INTEGER DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS idx_notes_created ON notes(deleted, created_at DESC);
        """)

        // 早期版本用 raw_text_uni 命名；老库补一列，避免已建的库在迁移时缺列报错
        if countForTest("SELECT count(*) FROM pragma_table_info('notes') WHERE name = 'search_uni'") == 0
            && countForTest("SELECT count(*) FROM pragma_table_info('notes') WHERE name = 'raw_text_uni'") > 0 {
            exec("ALTER TABLE notes ADD COLUMN search_uni TEXT;")
        }

        // trigram 表：3+ 字符，质量高。content=notes 表示不存正文，只存索引
        exec("""
        CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts_trigram USING fts5(
          raw_text, summary, tags,
          content='notes', content_rowid='rowid',
          tokenize='trigram'
        );
        """)

        // unigram 表：索引的是空格化的 search_uni（正文 + 摘要 + 标签）
        exec("""
        CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts_unigram USING fts5(
          search_uni,
          content='notes', content_rowid='rowid',
          tokenize='unicode61'
        );
        """)

        // 三种写操作都要同步索引，漏一个就会出现「改了搜不到」或「删了还在」
        exec("""
        CREATE TRIGGER IF NOT EXISTS notes_ai AFTER INSERT ON notes BEGIN
          INSERT INTO notes_fts_trigram(rowid, raw_text, summary, tags)
            VALUES (new.rowid, new.raw_text, new.summary, new.tags);
          INSERT INTO notes_fts_unigram(rowid, search_uni)
            VALUES (new.rowid, new.search_uni);
        END;

        CREATE TRIGGER IF NOT EXISTS notes_ad AFTER DELETE ON notes BEGIN
          INSERT INTO notes_fts_trigram(notes_fts_trigram, rowid, raw_text, summary, tags)
            VALUES('delete', old.rowid, old.raw_text, old.summary, old.tags);
          INSERT INTO notes_fts_unigram(notes_fts_unigram, rowid, search_uni)
            VALUES('delete', old.rowid, old.search_uni);
        END;

        CREATE TRIGGER IF NOT EXISTS notes_au AFTER UPDATE ON notes BEGIN
          INSERT INTO notes_fts_trigram(notes_fts_trigram, rowid, raw_text, summary, tags)
            VALUES('delete', old.rowid, old.raw_text, old.summary, old.tags);
          INSERT INTO notes_fts_trigram(rowid, raw_text, summary, tags)
            VALUES (new.rowid, new.raw_text, new.summary, new.tags);
          INSERT INTO notes_fts_unigram(notes_fts_unigram, rowid, search_uni)
            VALUES('delete', old.rowid, old.search_uni);
          INSERT INTO notes_fts_unigram(rowid, search_uni)
            VALUES (new.rowid, new.search_uni);
        END;
        """)
    }

    // MARK: - 逐字空格化（中文检索的关键）

    /// 写入 unigram 表的文本：把正文、摘要、标签拼在一起，再逐字插空格。
    ///
    /// ⚠️ 必须把 tags 和 summary 一起索引，否则会出现「标签叫咖啡、正文不写咖啡的
    ///    记录搜不到咖啡」——实测这会让 2 字查询漏掉一大半本该命中的记录，
    ///    而 2 字查询恰恰是中文最常用也最容易搜不到的一类。
    public static func spacedForIndex(_ s: String) -> String {
        var out = ""
        out.reserveCapacity(s.count * 2)
        var lastWasCJK: Bool? = nil
        for ch in s {
            let cjk = isCJK(ch)
            // 两种情况要插空格，缺一不可：
            //   ① 每个汉字前面都插（否则「包子店」还是一个 token，搜「包子」必然 0 命中）
            //   ② 西文字符紧跟在汉字后面时要插（否则「望京SOHO」切不开，
            //      查「望京」和查「SOHO」互相干扰）
            // 纯西文内部不插，否则 iPhone 被拆成 i P h o n e。
            let needSpace = cjk || (lastWasCJK == true)
            if needSpace && !out.isEmpty && !out.hasSuffix(" ") { out.append(" ") }
            out.append(ch)
            lastWasCJK = cjk
        }
        return out
    }

    /// 标签数组 → 索引文本
    public static func tagsText(_ tags: [String]) -> String {
        return tags.joined(separator: " ")
    }

    /// CJK 统一表意文字 + 扩展 + 假名 + 谚文，覆盖中日韩
    private static func isCJK(_ ch: Character) -> Bool {
        guard let u = ch.unicodeScalars.first else { return false }
        let v = u.value
        return (0x4E00...0x9FFF).contains(v)     // 基本汉字
            || (0x3400...0x4DBF).contains(v)    // 扩展 A
            || (0x3040...0x30FF).contains(v)    // 日文假名
            || (0xAC00...0xD7AF).contains(v)    // 韩文
            || (0xF900...0xFAFF).contains(v)    // 兼容表意
    }

    // MARK: - 读

    /// 全量读取（给前端渲染时间线用；个人笔记量级在千条以内，一次读完最快）
    public func loadAll(limit: Int = 2000) -> [[String: Any]] {
        let rows = query("""
        SELECT * FROM notes WHERE deleted = 0
        ORDER BY created_at DESC LIMIT ?
        """, [(":l", limit)])
        return rows.map { row -> [String: Any] in note(from: row).asDict() }
    }

    private func note(from row: [String: Any]) -> Note {
        func s(_ k: String) -> String { (row[k] as? String) ?? "" }
        func i(_ k: String) -> Int { (row[k] as? Int) ?? 0 }
        func iOpt(_ k: String) -> String? { row[k] as? String }

        let tags: [String] = (try? JSONDecoder().decode([String].self,
                            from: Data(s("tags").utf8))) ?? []
        let entities: [String: [String]] = (try? JSONDecoder().decode([String: [String]].self,
                            from: Data(s("entities").utf8))) ?? [:]

        return Note(id: s("id"),
                    createdAt: i("created_at"),
                    updatedAt: i("updated_at"),
                    source: s("source"),
                    rawText: s("raw_text"),
                    summary: iOpt("summary"),
                    tags: tags,
                    entities: entities,
                    audioPath: iOpt("audio_path"),
                    durationMs: i("duration_ms"),
                    language: iOpt("language"),
                    processState: s("process_state"),
                    rev: i("rev"),
                    deleted: i("deleted") == 1)
    }

    // MARK: - 写

    @discardableResult
    public func save(id: String? = nil, text: String, source: String,
                     tags: [String] = [], summary: String? = nil,
                     audioPath: String? = nil, durationMs: Int = 0,
                     language: String? = nil, processState: String? = nil) throws -> String {
        let now = Int(Date().timeIntervalSince1970 * 1000)
        let noteID = id ?? UUID().uuidString
        let raw = text
        let tagsJSON = (try? JSONEncoder().encode(tags)).flatMap { String(data: $0, encoding: .utf8) } ?? "[]"
        let entsJSON = "{}"
        // 索引文本覆盖正文 + 摘要 + 标签，缺一项就会漏搜
        let uni = DataStore.spacedForIndex(
            ([raw, summary ?? ""] + tags).filter { !$0.isEmpty }.joined(separator: " ")
        )

        if let _ = query("SELECT id FROM notes WHERE id = ?", [(":id", noteID)]).first {
            // 更新：rev 单调递增，供未来的 LWW 合并用
            let saved = execute("""
            UPDATE notes SET
              raw_text = ?, search_uni = ?, summary = ?, tags = ?,
              updated_at = ?, source = ?, audio_path = ?, duration_ms = ?,
              language = ?, process_state = ?, rev = rev + 1
            WHERE id = ?
            """, [(":raw", raw), (":uni", uni), (":sum", summary as Any),
                  (":tags", tagsJSON), (":up", now), (":src", source),
                  (":audio", audioPath as Any), (":dur", durationMs),
                  (":lang", language as Any), (":ps", processState as Any),
                  (":id", noteID)])
            guard saved else { throw StoreError.failed(errorMessage()) }
        } else {
            let saved = execute("""
            INSERT INTO notes
              (id, created_at, updated_at, source, raw_text, search_uni,
               summary, tags, entities, audio_path, duration_ms, language,
               process_state, device_id, rev, deleted)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,0)
            """, [(":id", noteID), (":c", now), (":up", now), (":src", source),
                  (":raw", raw), (":uni", uni), (":sum", summary as Any),
                  (":tags", tagsJSON), (":ents", entsJSON), (":audio", audioPath as Any),
                  (":dur", durationMs), (":lang", language as Any),
                  (":ps", processState ?? (raw.isEmpty ? "pending" : "done")), (":dev", "local")])
            guard saved else { throw StoreError.failed(errorMessage()) }
        }
        return noteID
    }

    /// 软删除 + rev 递增。不用真删：同步场景下 tombstone 防「删掉的又被同步回来」
    public func delete(id: String) throws {
        let saved = execute("UPDATE notes SET deleted = 1, updated_at = ?, rev = rev + 1 WHERE id = ?",
                    [(":up", Int(Date().timeIntervalSince1970 * 1000)), (":id", id)])
        guard saved else { throw StoreError.failed(errorMessage()) }
    }

    public func restore(id: String) throws {
        guard execute("UPDATE notes SET deleted = 0, updated_at = ?, rev = rev + 1 WHERE id = ?", [(":now", Int(Date().timeIntervalSince1970 * 1000)), (":id", id)]) else { throw StoreError.failed(errorMessage()) }
    }

    public func referencesAudio(path: String) -> Bool {
        !query("SELECT id FROM notes WHERE audio_path = ? LIMIT 1", [(":path", path)]).isEmpty
    }

    public func get(id: String) -> [String: Any]? {
        query("SELECT * FROM notes WHERE id = ? AND deleted = 0", [(":id", id)]).first.map { note(from: $0).asDict() }
    }

    public func updateText(id: String, text: String, tags: [String]) throws {
        guard let row = query("SELECT * FROM notes WHERE id = ? AND deleted = 0", [(":id", id)]).first else { throw StoreError.failed("这条记忆已不存在") }
        let n = note(from: row)
        _ = try save(id: id, text: text, source: n.source, tags: tags, summary: nil,
                     audioPath: n.audioPath, durationMs: n.durationMs, language: n.language,
                     processState: text.isEmpty ? n.processState : "done")
    }

    public func page(before: Int? = nil, beforeID: String = "", limit: Int = 50) -> [[String: Any]] {
        let size = min(200, max(1, limit))
        if let before {
            return query("SELECT * FROM notes WHERE deleted = 0 AND (created_at < ? OR (created_at = ? AND id < ?)) ORDER BY created_at DESC, id DESC LIMIT ?",
                         [(":before", before), (":same", before), (":id", beforeID), (":limit", size)]).map { note(from: $0).asDict() }
        }
        return query("SELECT * FROM notes WHERE deleted = 0 ORDER BY created_at DESC, id DESC LIMIT ?", [(":limit", size)]).map { note(from: $0).asDict() }
    }

    // MARK: - 检索（本文件的核心）

    /// 分流规则：
    ///   查询词去空白后长度 >= 3  → trigram 主查 + unigram 补（两者取并集）
    ///   长度 1-2               → 只走 unigram（trigram 对 <3 字符直接失效）
    /// 两个词的查询按 AND 语义：每个词分别走一次表，再取交集。
    public func search(_ rawQuery: String, limit: Int = 200, source: String? = nil) -> [[String: Any]] {
        let terms = rawQuery.split(whereSeparator: { $0.isWhitespace }).map(String.init)
        guard !terms.isEmpty else { return [] }
        // Intersect before limiting. Limiting each term first loses valid AND matches.
        let perTerm = terms.map { rowIDs(for: $0, limit: -1) }
        var common = Set(perTerm[0])
        for rows in perTerm.dropFirst() { common.formIntersection(rows) }
        guard !common.isEmpty else { return [] }
        var scores: [Int: Double] = [:]
        for rows in perTerm {
            for (rank, row) in rows.enumerated() { scores[row, default: 0] += 1 / Double(60 + rank) }
        }
        let ids = common.map(String.init).joined(separator: ",")
        let rows = query("SELECT rowid AS search_id, * FROM notes WHERE deleted = 0 AND rowid IN (\(ids))")
        // A phrase may span raw text / summary / tag boundaries in search_uni.
        // Validate each whole term within one field; never match 上海 against 海上.
        return rows.filter { row in
            let n = note(from: row)
            if let source, !source.isEmpty, n.source != source { return false }
            let fields = [n.rawText, n.summary ?? ""] + n.tags
            return terms.allSatisfy { term in fields.contains { $0.range(of: term, options: .caseInsensitive) != nil } }
        }.sorted { a, b in
            let sa = scores[a["search_id"] as? Int ?? 0] ?? 0
            let sb = scores[b["search_id"] as? Int ?? 0] ?? 0
            if sa != sb { return sa > sb }
            let ca = a["created_at"] as? Int ?? 0, cb = b["created_at"] as? Int ?? 0
            return ca == cb ? (a["id"] as? String ?? "") > (b["id"] as? String ?? "") : ca > cb
        }.prefix(max(0, limit)).map { note(from: $0).asDict() }
    }

    /// 单个词的 rowid 集合：trigram 与 unigram 的并集
    private func rowIDs(for term: String, limit: Int) -> [Int] {
        let chars = term.count
        var sets: [[Int]] = []

        // trigram：>= 3 字符才有意义，且子串越少分值越高
        if chars >= 3 {
            sets.append(intRows("""
            SELECT rowid FROM notes_fts_trigram
            WHERE notes_fts_trigram MATCH ? AND rowid IN (SELECT rowid FROM notes WHERE deleted = 0)
            ORDER BY rank LIMIT ?
            """, [(":m", ftsQuote(term)), (":l", limit)]))
        }

        // unigram：逐字空格化后 AND 查询，1-2 字符的主力
        sets.append(intRows("""
        SELECT rowid FROM notes_fts_unigram
        WHERE notes_fts_unigram MATCH ? AND rowid IN (SELECT rowid FROM notes WHERE deleted = 0)
        ORDER BY rank LIMIT ?
        """, [(":m", spacedQuery(term)), (":l", limit)]))

        // 多词（西文里的空格）也逐词拆开 AND
        let parts = term.split(whereSeparator: { $0 == " " }).map(String.init).filter { !$0.isEmpty }
        if parts.count > 1 {
            var perPart: [[Int]] = []
            for p in parts { perPart.append(rowIDs(for: p, limit: limit)) }
            var inter = perPart[0]
            for s in perPart.dropFirst() { inter = inter.filter { s.contains($0) } }
            sets.append(inter)
        }

        var seen = Set<Int>()
        return sets.flatMap { $0 }.filter { seen.insert($0).inserted }
    }

    /// 查询词转 FTS5 MATCH 语法：双引号包裹，内部引号翻倍，避免被当作语法
    private func ftsQuote(_ s: String) -> String {
        return "\"" + s.replacingOccurrences(of: "\"", with: "\"\"") + "\""
    }

    private func spacedQuery(_ s: String) -> String {
        return ftsQuote(DataStore.spacedForIndex(s))
    }

    private func intRows(_ sql: String, _ bind: [(String, Any)]) -> [Int] {
        guard let st = prepare(sql) else { return [] }
        defer { sqlite3_finalize(st) }
        bindBind(st, bind)
        var out: [Int] = []
        var status = sqlite3_step(st)
        while status == SQLITE_ROW {
            out.append(Int(sqlite3_column_int64(st, 0)))
            status = sqlite3_step(st)
        }
        if status != SQLITE_DONE { failure = errorMessage() }
        return out
    }

    // MARK: - 导出

    /// 全部数据导出为 JSON 字符串（数据是唯一真相源，导出格式跟着数据走）
    public func exportJSON(id: String? = nil) -> String {
        let rows = id.map { query("SELECT * FROM notes WHERE id = ? AND deleted = 0", [(":id", $0)]) } ?? query("SELECT * FROM notes ORDER BY created_at DESC")
        let notes = rows.map { note(from: $0) }
        let payload: [String: Any] = [
            "product": "只言",
            "schema": 1,
            "exported_at": Int(Date().timeIntervalSince1970 * 1000),
            "count": notes.count,
            "notes": notes.map { n -> [String: Any] in
                [
                    "id": n.id,
                    "created_at": n.createdAt,
                    "updated_at": n.updatedAt,
                    "source": n.source,
                    "raw_text": n.rawText,
                    "summary": n.summary ?? NSNull(),
                    "tags": n.tags,
                    "entities": n.entities,
                    "duration_ms": n.durationMs,
                    "language": n.language ?? NSNull(),
                    "process_state": n.processState,
                    "rev": n.rev,
                    "deleted": n.deleted,
                    "audio_path": n.audioPath ?? NSNull(),
                ]
            },
        ]
        guard let data = try? JSONSerialization.data(withJSONObject: payload,
                                                   options: [.prettyPrinted, .sortedKeys,
                                                             .withoutEscapingSlashes]),
              let s = String(data: data, encoding: .utf8) else { return "{}" }
        return s
    }

    /// 导出为 Markdown：人直接能读，这是「随时能带走」这个承诺的落地形态
    public func exportMarkdown(id: String? = nil) -> String {
        let rows = id.map { query("SELECT * FROM notes WHERE id = ? AND deleted = 0", [(":id", $0)]) } ?? query("SELECT * FROM notes WHERE deleted = 0 ORDER BY created_at DESC")
        let notes = rows.map { note(from: $0) }
        let df = DateFormatter()
        df.dateFormat = "yyyy-MM-dd HH:mm"
        df.locale = Locale(identifier: "zh_CN")

        var out = "# 只言 · 全部记忆\n\n"
        out += "共 \(notes.count) 条 · 导出于 \(df.string(from: Date()))\n\n---\n\n"
        for n in notes {
            let d = Date(timeIntervalSince1970: Double(n.createdAt) / 1000)
            out += "## \(df.string(from: d))\n\n"
            if !n.rawText.isEmpty { out += "\(n.rawText)\n\n" }
            if let s = n.summary, !s.isEmpty { out += "> \(s)\n\n" }
            if !n.tags.isEmpty { out += "标签：\(n.tags.joined(separator: "、"))\n\n" }
            for (kind, values) in n.entities.sorted(by: { $0.key < $1.key }) where !values.isEmpty {
                out += "\(kind)：\(values.joined(separator: "、"))\n"
            }
            if !n.entities.isEmpty { out += "\n" }
            out += "---\n\n"
        }
        return out
    }

    /// 写文件。返回实际路径，失败返回 nil
    @discardableResult
    public func writeExport(format: String, platform: String, id: String? = nil) -> String? {
        let content = (format == "md") ? exportMarkdown(id: id) : exportJSON(id: id)
        let ext = (format == "md") ? "md" : "json"
        let df = DateFormatter()
        df.dateFormat = "yyyyMMdd-HHmmss"
        let name = "只言-导出-\(df.string(from: Date())).\(ext)"
        let dir = mediaDirectory
        let target = dir.appendingPathComponent(name)
        do {
            try content.write(to: target, atomically: true, encoding: .utf8)
            return target.path
        } catch {
            NSLog("[只言] 导出写文件失败: \(error)")
            return nil
        }
    }

    // MARK: - 统计与维护

    public func stats() -> [String: Int] {
        let total = (query("SELECT count(*) c FROM notes WHERE deleted = 0").first?["c"] as? Int) ?? 0
        let withAudio = (query("SELECT count(*) c FROM notes WHERE deleted = 0 AND audio_path IS NOT NULL").first?["c"] as? Int) ?? 0
        let pending = (query("SELECT count(*) c FROM notes WHERE deleted = 0 AND process_state = 'pending'").first?["c"] as? Int) ?? 0
        let chars = (query("SELECT coalesce(sum(length(raw_text)),0) c FROM notes WHERE deleted = 0").first?["c"] as? Int) ?? 0
        return ["total": total, "with_audio": withAudio, "pending": pending, "chars": chars]
    }

    /// 索引可随时重建 —— 数据是唯一真相源，索引坏了不丢数据（方案 3.6）
    public func rebuildIndex() {
        exec("INSERT INTO notes_fts_trigram(notes_fts_trigram) VALUES('rebuild');")
        exec("INSERT INTO notes_fts_unigram(notes_fts_unigram) VALUES('rebuild');")
    }

    /// 清空全部（含索引）。给设置页的「清空数据」用
    public func wipe() {
        exec("DELETE FROM notes;")
        exec("INSERT INTO notes_fts_trigram(notes_fts_trigram) VALUES('rebuild');")
        exec("INSERT INTO notes_fts_unigram(notes_fts_unigram) VALUES('rebuild');")
    }

    // MARK: - 批量导入示例数据（演示用）

    /// 返回导入条数。示例数据只标 text/voice 来源，不带 AI 摘要
    @discardableResult
    public func importSamples(_ items: [[String: Any]]) throws -> Int {
        guard exec("BEGIN;") else { throw StoreError.failed(errorMessage()) }
        var committed = false
        defer { if !committed { exec("ROLLBACK;") } }
        var n = 0
        for it in items {
            let raw = (it["raw"] as? String) ?? ""
            let ok = query("SELECT id FROM notes WHERE id = ?", [(":id", (it["id"] as? String) ?? "")]).isEmpty
            guard ok else { continue }
            _ = try save(id: it["id"] as? String, text: raw,
                     source: (it["source"] as? String) ?? "text",
                     tags: it["tags"] as? [String] ?? [],
                     summary: it["summary"] as? String,
                     durationMs: Int(((it["dur"] as? Double) ?? 0) * 1000),
                     processState: "done")
            n += 1
        }
        guard exec("COMMIT;") else { throw StoreError.failed(errorMessage()) }
        committed = true
        return n
    }

    /// 改写入库时间（仅示例数据用，让时间线看起来是过去的几天而不是全挤在今天）
    public func setCreatedAt(id: String, ms: Int) {
        _ = execute("UPDATE notes SET created_at = ?, updated_at = ? WHERE id = ?",
                    [(":c", ms), (":u", ms), (":id", id)])
    }

    // MARK: - 测试探针
    // 只给 tests/TestData.swift 用。放在这里是因为 query/exec 是 private，
    // 测试需要绕过 API 直接确认表结构，FTS5 是否真的建起来了只能这么验。

    /// 跑一条聚合查询返回 Int，用于确认表是否存在（SQLite 里「查不存在的表」才报错）
    public func countForTest(_ sql: String) -> Int {
        guard let st = prepare(sql) else { return -1 }
        defer { sqlite3_finalize(st) }
        var n = -1
        if sqlite3_step(st) == SQLITE_ROW { n = Int(sqlite3_column_int64(st, 0)) }
        return n
    }

    /// 同上，但执行任意 SELECT 并取第一列 Int
    public func probeTest(_ sql: String) -> Int {
        return countForTest(sql)
    }

    /// 取一行的原始列值（保留 NSNull，用于验证「真的写成了 NULL」而不是字符串）
    public func dumpRowForTest(id: String) -> [String: Any] {
        return query("SELECT * FROM notes WHERE id = ?", [(":id", id)]).first ?? [:]
    }

    // MARK: - 日期工具（前端也要用，保持一份实现）

    public static func dayKey(_ ms: Int) -> String {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd"
        f.locale = Locale(identifier: "en_US_POSIX")
        return f.string(from: Date(timeIntervalSince1970: Double(ms) / 1000))
    }

    public static func timeText(_ ms: Int) -> String {
        let f = DateFormatter()
        f.dateFormat = "HH:mm"
        f.locale = Locale(identifier: "en_US_POSIX")
        return f.string(from: Date(timeIntervalSince1970: Double(ms) / 1000))
    }
}
