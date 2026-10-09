// ==========================================
// KONFIGURASI SUPABASE & INTEGRASI
// Copy file ini menjadi config.js dan isi dengan kredensial kamu.
// ==========================================
const SUPABASE_URL = "your_supabase_url_here";
const SUPABASE_ANON_KEY = "your_supabase_anon_key_here";

// Dapatkan site key di: https://www.google.com/recaptcha/admin (reCAPTCHA v3)
const RECAPTCHA_SITE_KEY = "your_recaptcha_v3_site_key_here";

// 1. Webhook Log Aktivitas Sistem (opsional - kosongkan string jika tidak ingin digunakan)
const DISCORD_WEBHOOK_URL = "https://discord.com/api/webhooks/YOUR_ACTIVITY_WEBHOOK_HERE";

// 2. Webhook Pengumuman Ulang Tahun Hari Ini (opsional - kosongkan string jika tidak ingin digunakan)
const DISCORD_BIRTHDAY_WEBHOOK_URL = "https://discord.com/api/webhooks/YOUR_BIRTHDAY_WEBHOOK_HERE";
