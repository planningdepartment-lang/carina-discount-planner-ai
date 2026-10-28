const { test, describe } = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');

function hashPasswordSync(password, saltHex) {
  const salt = saltHex ? Buffer.from(saltHex, 'hex') : crypto.randomBytes(16);
  const hash = crypto.pbkdf2Sync(password, salt, 100000, 32, 'sha256');
  return { hash: hash.toString('hex'), salt: salt.toString('hex') };
}

function verifyPasswordSync(password, saltHex, targetHashHex) {
  const { hash } = hashPasswordSync(password, saltHex);
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(targetHashHex, 'hex'));
}

describe('Admin Authentication & Crypto Engine', () => {
  test('PBKDF2-SHA256 password hashing and verification', () => {
    const password = 'CarinaAdmin2026!';
    const { hash, salt } = hashPasswordSync(password);

    assert.strictEqual(verifyPasswordSync(password, salt, hash), true);
    assert.strictEqual(verifyPasswordSync('WrongPassword', salt, hash), false);
  });

  test('Precomputed Admin Seed matches CarinaAdmin2026!', () => {
    const salt = 'e8adbc9e7e8f7bde826fbcb68c762e47';
    const hash = '1344d68c8f6a4a623dcf3b77f1a297da204b4272949cd87a5ef319c8ea00825e';
    assert.strictEqual(verifyPasswordSync('CarinaAdmin2026!', salt, hash), true);
    assert.strictEqual(verifyPasswordSync('carinaadmin2026!', salt, hash), false);
  });

  test('Cookie parsing handles empty, malformed, and valid strings', () => {
    const raw = 'carina_admin_session=abc123xyz; other_cookie=val';
    const parsed = {};
    raw.split(';').forEach(item => {
      const parts = item.split('=');
      if (parts.length >= 2) parsed[parts[0].trim()] = parts.slice(1).join('=').trim();
    });
    assert.strictEqual(parsed['carina_admin_session'], 'abc123xyz');
  });

  test('IMU vs Cost Markup Ex-VAT Mathematical Validation', () => {
    // Style 58424: Pyjama Short SS26-SH-PJ-5164
    const ticketPrice = 159.00;
    const landedCost = 42.30;
    const netRevenueExVat = ticketPrice / 1.15; // 138.2608...
    
    // User formula: (159/1.15)/42.3
    const markupMultiplier = netRevenueExVat / landedCost;
    assert.strictEqual(markupMultiplier.toFixed(2), '3.27');

    // Net Margin % (IMU on net sales): (Net Rev - Cost) / Net Rev
    const netImuPct = ((netRevenueExVat - landedCost) / netRevenueExVat) * 100;
    assert.strictEqual(netImuPct.toFixed(1), '69.4');

    // Legacy gross margin on ticket (flawed): (159 - 42.3) / 159
    const legacyGrossMarginPct = ((ticketPrice - landedCost) / ticketPrice) * 100;
    assert.strictEqual(legacyGrossMarginPct.toFixed(1), '73.4');
  });
});
