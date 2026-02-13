const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

// Use DATA_DIR env var for persistent storage (e.g. Railway volume mount)
// Falls back to __dirname for local development
const DATA_DIR = process.env.DATA_DIR || __dirname;
const DB_FILE = path.join(DATA_DIR, 'licenses.json');
const USAGE_FILE = path.join(DATA_DIR, 'usage.json');

// Initialize database file if it doesn't exist
async function initDB() {
  try {
    await fs.access(DB_FILE);
  } catch {
    await fs.writeFile(DB_FILE, JSON.stringify({ licenses: [] }, null, 2));
  }
}

// Read database
async function readDB() {
  await initDB();
  const data = await fs.readFile(DB_FILE, 'utf8');
  return JSON.parse(data);
}

// Write database
async function writeDB(data) {
  await fs.writeFile(DB_FILE, JSON.stringify(data, null, 2));
}

// Generate a license key
function generateLicenseKey() {
  const segments = [];
  for (let i = 0; i < 4; i++) {
    segments.push(crypto.randomBytes(2).toString('hex').toUpperCase());
  }
  return `VIBEY-${segments.join('-')}`;
}

// Create a new license
async function createLicense(email, plan, stripeCustomerId, stripeSubscriptionId) {
  const db = await readDB();

  const license = {
    key: generateLicenseKey(),
    email,
    plan, // 'lifetime'
    status: 'active',
    stripeCustomerId,
    stripeSubscriptionId,
    createdAt: Date.now(),
    renewsAt: null, // Will be set from Stripe subscription
    expiresAt: null
  };

  db.licenses.push(license);
  await writeDB(db);

  return license;
}

// Get license by key
async function getLicenseByKey(key) {
  const db = await readDB();
  return db.licenses.find(l => l.key === key);
}

// Get license by Stripe subscription ID
async function getLicenseBySubscriptionId(subscriptionId) {
  const db = await readDB();
  return db.licenses.find(l => l.stripeSubscriptionId === subscriptionId);
}

// Get license by email (returns most recent if multiple exist)
async function getLicenseByEmail(email) {
  const db = await readDB();
  const matches = db.licenses.filter(l => l.email === email);
  if (matches.length === 0) return null;
  // Return the most recently created license
  return matches.sort((a, b) => b.createdAt - a.createdAt)[0];
}

// Update license
async function updateLicense(key, updates) {
  const db = await readDB();
  const index = db.licenses.findIndex(l => l.key === key);

  if (index === -1) return null;

  db.licenses[index] = { ...db.licenses[index], ...updates };
  await writeDB(db);

  return db.licenses[index];
}

// Usage tracking
async function initUsageDB() {
  try {
    await fs.access(USAGE_FILE);
  } catch {
    await fs.writeFile(USAGE_FILE, JSON.stringify({}, null, 2));
  }
}

async function recordUsage(deviceId, licenseKey, appVersion, trialEndDate) {
  await initUsageDB();
  const data = await fs.readFile(USAGE_FILE, 'utf8');
  const usage = JSON.parse(data);

  if (!usage[deviceId]) {
    usage[deviceId] = {
      firstSeen: Date.now(),
      lastSeen: Date.now(),
      sessionCount: 0,
      appVersion: appVersion || 'unknown',
      licenseKey: null,
      trialEndDate: null
    };
  }

  usage[deviceId].lastSeen = Date.now();
  usage[deviceId].sessionCount = (usage[deviceId].sessionCount || 0) + 1;
  if (appVersion) usage[deviceId].appVersion = appVersion;
  if (licenseKey) usage[deviceId].licenseKey = licenseKey;
  if (trialEndDate) usage[deviceId].trialEndDate = trialEndDate;

  await fs.writeFile(USAGE_FILE, JSON.stringify(usage, null, 2));
  return usage[deviceId];
}

async function getAllUsage() {
  await initUsageDB();
  const data = await fs.readFile(USAGE_FILE, 'utf8');
  return JSON.parse(data);
}

module.exports = {
  generateLicenseKey,
  createLicense,
  getLicenseByKey,
  getLicenseBySubscriptionId,
  getLicenseByEmail,
  updateLicense,
  recordUsage,
  getAllUsage
};
