// Cooldown per-utente in memoria. Non persiste tra riavvii (volutamente:
// 30 secondi di throttle sono comunque sufficienti come anti-spam).

const lastUsedByUser = new Map();

/**
 * Verifica il cooldown di un utente per una certa azione.
 * @param {string} userId - Discord user ID
 * @param {string} action - identificatore azione (es. 'check_bici')
 * @param {number} cooldownMs - durata cooldown in ms
 * @returns {{ ok: boolean, remainingMs: number }}
 */
function checkCooldown(userId, action, cooldownMs) {
  const key = `${userId}:${action}`;
  const now = Date.now();
  const prev = lastUsedByUser.get(key) || 0;
  const diff = now - prev;
  if (diff < cooldownMs) {
    return { ok: false, remainingMs: cooldownMs - diff };
  }
  return { ok: true, remainingMs: 0 };
}

/** Registra l'uso ora (chiama subito dopo aver concesso l'azione). */
function markUsed(userId, action) {
  lastUsedByUser.set(`${userId}:${action}`, Date.now());
}

module.exports = { checkCooldown, markUsed };
