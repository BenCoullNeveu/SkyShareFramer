// Aladin Lite can touch localStorage; in restricted previews this may throw.
(function ensureLocalStorageAccess() {
    try {
    const ls = window.localStorage;
    const key = "__aladin_ls_test__";
    ls.setItem(key, "1");
    ls.removeItem(key);
    } catch (_) {
    const memoryStore = {};
    const fallbackStorage = {
        getItem(key) {
        const k = String(key);
        return Object.prototype.hasOwnProperty.call(memoryStore, k) ? memoryStore[k] : null;
        },
        setItem(key, value) {
        memoryStore[String(key)] = String(value);
        },
        removeItem(key) {
        delete memoryStore[String(key)];
        },
        clear() {
        Object.keys(memoryStore).forEach((k) => delete memoryStore[k]);
        },
        key(index) {
        const keys = Object.keys(memoryStore);
        return keys[index] || null;
        },
        get length() {
        return Object.keys(memoryStore).length;
        }
    };

    try {
        Object.defineProperty(window, 'localStorage', {
        value: fallbackStorage,
        configurable: true
        });
    } catch (_inner) {
        // If this cannot be overridden, we handle it in the init catch block below.
    }
    }
})();