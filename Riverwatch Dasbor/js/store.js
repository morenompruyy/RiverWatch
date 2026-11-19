// Penyimpanan keadaan sederhana: satu sumber kebenaran, langganan per kunci.
const S = Object.create(null);
const subs = Object.create(null);

export const store = {
  get(k) { return S[k]; },
  set(k, v) {
    S[k] = v;
    const l = subs[k]; if (l) for (const fn of Array.from(l)) { try { fn(v); } catch (e) { console.error('store', k, e); } }
  },
  /** Langganan; kembalikan fungsi berhenti. `now` = panggil sekarang dengan nilai yang ada. */
  on(k, fn, now = false) {
    (subs[k] = subs[k] || new Set()).add(fn);
    if (now && S[k] !== undefined) fn(S[k]);
    return () => subs[k].delete(fn);
  }
};

/** Penyimpanan lokal aman (bisa diblokir di jendela privat). */
export const prefs = {
  get(k, d = null) { try { const v = localStorage.getItem('rw.' + k); return v == null ? d : v; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('rw.' + k, String(v)); } catch (e) { /* abaikan */ } },
  del(k) { try { localStorage.removeItem('rw.' + k); } catch (e) { /* abaikan */ } }
};
