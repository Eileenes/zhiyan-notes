// C ABI of the shared Rust core (core/src/lib.rs). The Swift shell binds these
// with @_silgen_name, so this header is only shipped inside the XCFramework
// for other consumers and for symbol documentation.
#ifndef ZHIYAN_CORE_H
#define ZHIYAN_CORE_H

#ifdef __cplusplus
extern "C" {
#endif

/// Runs one JSON request against the SQLite database at `path`.
/// Returns a newly allocated UTF-8 JSON string `{ok, data|error}`; release it
/// with zy_core_free. Never returns a pointer that must not be freed.
char *zy_core_call(const char *path, const char *request);

/// Frees a string returned by zy_core_call. NULL is ignored.
void zy_core_free(char *ptr);

#ifdef __cplusplus
}
#endif

#endif
