import Foundation

var failures = 0
func expect(_ ok: Bool, _ name: String) { print((ok ? "PASS " : "FAIL ") + name); if !ok { failures += 1 } }
func page(_ csp: String) -> String {
    "<!DOCTYPE html><html><head>\n<meta http-equiv=\"Content-Security-Policy\" content=\"\(csp)\">\n<meta charset=\"utf-8\"><script src=\"a.js\"></script></head></html>"
}
let good = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; object-src 'none'"
expect(WebPolicy.pageIsProtected(page(good)), "self-only script-src accepted")
for bad in ["'self' 'unsafe-inline'", "'self' 'unsafe-eval'", "'self' 'unsafe-hashes'", "'self' *", "'self' https:", "'self' file:", "'self' data:", "'self' https://cdn.example", "'self' 'strict-dynamic'", "'self' 'UNSAFE-INLINE'"] {
    expect(!WebPolicy.pageIsProtected(page("default-src 'self'; script-src \(bad)")), "rejects script-src \(bad)")
}
expect(!WebPolicy.pageIsProtected(page("default-src 'self' 'unsafe-eval'")), "default-src fallback is checked")
expect(!WebPolicy.pageIsProtected(page("style-src 'self'")), "no script/default directive rejected")
expect(!WebPolicy.pageIsProtected(page("script-src")), "empty script-src rejected")
expect(WebPolicy.pageIsProtected(page("script-src 'self'; script-src 'unsafe-inline'")), "first duplicate directive wins (CSP spec)")
expect(!WebPolicy.pageIsProtected(page("script-src 'unsafe-inline'; script-src 'self'")), "later duplicate cannot rescue unsafe first")
expect(!WebPolicy.pageIsProtected("<html><head><!-- script-src 'self' --></head></html>"), "comment text is not a policy")
expect(!WebPolicy.pageIsProtected("<html><head><script>x</script><meta http-equiv=\"Content-Security-Policy\" content=\"script-src 'self'\"></head>"), "meta after a script is ignored")
expect(!WebPolicy.pageIsProtected("<head><meta name=\"x\" content=\"script-src 'self'\"></head>"), "non-CSP meta ignored")
expect(WebPolicy.pageIsProtected("<head><META HTTP-EQUIV='content-security-policy' CONTENT=\"script-src 'self'\"></head>"), "case-insensitive attributes")

// The policy actually shipped (build/apple-csp.txt, run from the repo root).
if let shipped = try? String(contentsOfFile: "build/apple-csp.txt", encoding: .utf8) {
    expect(WebPolicy.pageIsProtected(page(shipped.trimmingCharacters(in: .whitespacesAndNewlines))), "shipped build/apple-csp.txt accepted")
} else { expect(false, "build/apple-csp.txt readable from cwd") }

let root = URL(fileURLWithPath: "/tmp/App.app/Web", isDirectory: true)
expect(WebPolicy.decide(root.appendingPathComponent("index.html"), webRoot: root) == .allow, "bundled page allowed")
expect(WebPolicy.decide(URL(string: "file:///tmp/App.app/Web/../../etc/passwd"), webRoot: root) == .cancel, "file traversal cancelled")
expect(WebPolicy.decide(URL(string: "file:///tmp/App.app/WebEvil/x.html"), webRoot: root) == .cancel, "sibling prefix cancelled")
expect(WebPolicy.decide(URL(string: "file:///etc/hosts"), webRoot: root) == .cancel, "other file cancelled")
let ext = URL(string: "https://example.com/")!
expect(WebPolicy.decide(ext, webRoot: root) == .openExternally(ext), "https opens externally")
expect(WebPolicy.decide(URL(string: "javascript:alert(1)"), webRoot: root) == .cancel, "javascript: cancelled")
expect(WebPolicy.decide(URL(string: "data:text/html,hi"), webRoot: root) == .cancel, "data: cancelled")
expect(WebPolicy.decide(URL(string: "about:blank"), webRoot: root) == .allow, "about:blank allowed")
expect(WebPolicy.decide(nil, webRoot: root) == .cancel, "nil cancelled")
print(failures == 0 ? "ALL PASS" : "\(failures) FAILED")
exit(failures == 0 ? 0 : 1)
