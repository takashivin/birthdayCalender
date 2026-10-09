/* ========================================================
   Birthday Calendar - Daily Discord Webhook Notification
   Dijalankan otomatis oleh GitHub Actions setiap jam 00:00 WIB
   ======================================================== */

const fs = require("fs");
const path = require("path");

// 1. Ambil Konfigurasi (dari Environment Variables / GitHub Secrets atau dari config.js)
function getConfigs() {
    let supabaseUrl = process.env.SUPABASE_URL;
    let supabaseKey = process.env.SUPABASE_ANON_KEY;
    let discordWebhook = process.env.DISCORD_BIRTHDAY_WEBHOOK_URL;

    const configPath = path.join(__dirname, "config.js");
    if (fs.existsSync(configPath)) {
        const content = fs.readFileSync(configPath, "utf8");
        const matchUrl = content.match(/SUPABASE_URL\s*=\s*["']([^"']+)["']/);
        const matchKey = content.match(/SUPABASE_ANON_KEY\s*=\s*["']([^"']+)["']/);
        const matchDiscord = content.match(/DISCORD_BIRTHDAY_WEBHOOK_URL\s*=\s*["']([^"']+)["']/);

        if (!supabaseUrl && matchUrl) supabaseUrl = matchUrl[1];
        if (!supabaseKey && matchKey) supabaseKey = matchKey[1];
        if (!discordWebhook && matchDiscord) discordWebhook = matchDiscord[1];
    }

    return { supabaseUrl, supabaseKey, discordWebhook };
}

const MONTH_NAMES = [
    "Januari", "Februari", "Maret", "April", "Mei", "Juni",
    "Juli", "Agustus", "September", "Oktober", "November", "Desember"
];

async function main() {
    const { supabaseUrl, supabaseKey, discordWebhook } = getConfigs();

    if (!supabaseUrl || !supabaseKey) {
        console.error("Error: SUPABASE_URL atau SUPABASE_ANON_KEY tidak ditemukan.");
        process.exit(1);
    }

    if (!discordWebhook) {
        console.warn("Peringatan: DISCORD_BIRTHDAY_WEBHOOK_URL tidak ditemukan. Pengiriman dibatalkan.");
        process.exit(0);
    }

    // Hitung tanggal hari ini dalam zona waktu WIB (Asia/Jakarta, UTC+7)
    const nowWib = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Jakarta" }));
    const todayDay = nowWib.getDate();
    const todayMonth = nowWib.getMonth() + 1; // 1-12
    const todayYear = nowWib.getFullYear();

    console.log(`Pengecekan ulang tahun untuk tanggal: ${todayDay} ${MONTH_NAMES[todayMonth - 1]} ${todayYear} (WIB)...`);

    // Ambil data ulang tahun approved dari Supabase REST API
    const endpoint = `${supabaseUrl}/rest/v1/birthdays?status=eq.approved&day=eq.${todayDay}&month=eq.${todayMonth}&select=*`;
    const response = await fetch(endpoint, {
        headers: {
            "apikey": supabaseKey,
            "Authorization": `Bearer ${supabaseKey}`,
            "Content-Type": "application/json"
        }
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Gagal mengambil data dari Supabase (${response.status}): ${errorText}`);
    }

    const celebrants = await response.json();

    if (!Array.isArray(celebrants) || celebrants.length === 0) {
        console.log(`Tidak ada yang berulang tahun hari ini (${todayDay} ${MONTH_NAMES[todayMonth - 1]}). Tidak ada webhook yang dikirim.`);
        return;
    }

    console.log(`Ditemukan ${celebrants.length} orang yang ulang tahun hari ini:`, celebrants.map(c => c.name).join(", "));

    // Siapkan pesan Discord Embed
    const celebrantsListText = celebrants.map(c => `• **${c.name}**`).join("\n");
    const payload = {
        username: "Birthday Calendar",
        avatar_url: "https://cdn-icons-png.flaticon.com/512/3135/3135715.png",
        embeds: [
            {
                title: "Hari Ini Ada yang Ulang Tahun!",
                description: `Hari ini, tanggal **${todayDay} ${MONTH_NAMES[todayMonth - 1]}**, ada teman yang sedang berulang tahun:\n\n${celebrantsListText}\n\nYuk berikan doa dan ucapan selamat ulang tahun!`,
                color: 0xffcc00, // Gold / Kuning Emas
                fields: [
                    { name: "Jumlah", value: `${celebrants.length} orang`, inline: true },
                    { name: "Zona Waktu", value: "WIB (Asia/Jakarta)", inline: true }
                ],
                footer: {
                    text: "Birthday Calendar Automated System (00:00 WIB)"
                },
                timestamp: new Date().toISOString()
            }
        ]
    };

    const webhookResponse = await fetch(discordWebhook, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
    });

    if (!webhookResponse.ok) {
        const errBody = await webhookResponse.text();
        throw new Error(`Gagal mengirim ke Discord Webhook (${webhookResponse.status}): ${errBody}`);
    }

    console.log("Berhasil mengirim notifikasi ulang tahun ke Discord!");
}

main().catch(err => {
    console.error("Terjadi kesalahan:", err);
    process.exit(1);
});

