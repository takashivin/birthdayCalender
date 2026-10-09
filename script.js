/* ============================================
   Supabase Setup — Run ALL of this in SQL Editor:
   ─────────────────────────────────────────────

   -- 1. Profiles table
   CREATE TABLE profiles (
       id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
       email TEXT NOT NULL,
       is_admin BOOLEAN DEFAULT FALSE,
       created_at TIMESTAMPTZ DEFAULT NOW()
   );
   ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
   CREATE POLICY "Read all profiles" ON profiles FOR SELECT TO authenticated USING (true);
   CREATE POLICY "Insert own profile" ON profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);

   -- 2. Auto-create profile on signup
   CREATE OR REPLACE FUNCTION public.handle_new_user()
   RETURNS TRIGGER AS $$
   BEGIN
       INSERT INTO public.profiles (id, email, is_admin) VALUES (NEW.id, NEW.email, false);
       RETURN NEW;
   END;
   $$ LANGUAGE plpgsql SECURITY DEFINER;

   CREATE TRIGGER on_auth_user_created
       AFTER INSERT ON auth.users
       FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

   -- 3. Birthdays table (Tabel Tunggal: pending, approved, rejected)
   CREATE TABLE birthdays (
       id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
       name TEXT NOT NULL,
       day SMALLINT NOT NULL CHECK (day >= 1 AND day <= 31),
       month SMALLINT NOT NULL CHECK (month >= 1 AND month <= 12),
       user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
       user_email TEXT NOT NULL,
       status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
       created_at TIMESTAMPTZ DEFAULT NOW()
   );
   ALTER TABLE birthdays ENABLE ROW LEVEL SECURITY;

   -- Anon users can read approved only
   CREATE POLICY "Anon read approved" ON birthdays FOR SELECT TO anon USING (status = 'approved');

   -- Authenticated: approved + own submissions + admin sees all
   CREATE POLICY "Auth read" ON birthdays FOR SELECT TO authenticated USING (
       status = 'approved'
       OR user_id = auth.uid()
       OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true)
   );
   CREATE POLICY "Insert own" ON birthdays FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
   CREATE POLICY "Delete own or admin" ON birthdays FOR DELETE TO authenticated USING (
       user_id = auth.uid()
       OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true)
   );
   CREATE POLICY "Admin update" ON birthdays FOR UPDATE TO authenticated USING (
       EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true)
   ) WITH CHECK (
       EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true)
   );

   -- 4. Make admin (run AFTER registering):
   -- UPDATE profiles SET is_admin = true WHERE email = 'your@email.com';

   ============================================ */

/* ============================================
   SUPABASE CLIENT
   ============================================ */
let db;
try {
    const createFn = (typeof supabase !== "undefined" && supabase.createClient)
        ? supabase.createClient : null;
    if (!createFn) throw new Error("Supabase JS library not loaded.");
    db = createFn(SUPABASE_URL, SUPABASE_ANON_KEY);
    console.log("Supabase client initialized");
} catch (err) {
    console.error("Supabase init error:", err);
}

/* ============================================
   SVG ICONS (Optimized & Reusable)
   ============================================ */
const ICON = {
    moon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>',
    sun: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>',
    check: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
    cross: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
    confirmSuccess: '<svg class="confirm-icon" width="38" height="38" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>',
    confirmDanger: '<svg class="confirm-icon" width="38" height="38" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>',
    calendar: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-1px; margin-right:5px; flex-shrink:0;"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>',
    trash: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>'
};

/* ============================================
   RECAPTCHA v3 HELPER (LAZY LOADED)
   ============================================ */
let recaptchaLoaded = false;
let recaptchaLoadingPromise = null;

function loadRecaptchaScript() {
    if (recaptchaLoaded) return Promise.resolve(true);
    if (recaptchaLoadingPromise) return recaptchaLoadingPromise;

    if (typeof RECAPTCHA_SITE_KEY === "undefined" || !RECAPTCHA_SITE_KEY || RECAPTCHA_SITE_KEY.startsWith("your_")) {
        return Promise.resolve(false);
    }

    recaptchaLoadingPromise = new Promise(resolve => {
        if (typeof grecaptcha !== "undefined") {
            recaptchaLoaded = true;
            return resolve(true);
        }

        const script = document.createElement("script");
        script.src = `https://www.google.com/recaptcha/api.js?render=${encodeURIComponent(RECAPTCHA_SITE_KEY)}`;
        script.async = true;
        script.onload = () => {
            recaptchaLoaded = true;
            resolve(true);
        };
        script.onerror = (err) => {
            console.warn("Gagal memuat script reCAPTCHA:", err);
            resolve(false);
        };
        setTimeout(() => {
            if (!recaptchaLoaded) {
                console.warn("reCAPTCHA load timeout");
                resolve(false);
            }
        }, 4000);

        document.head.appendChild(script);
    });

    return recaptchaLoadingPromise;
}

async function getRecaptchaToken(action) {
    if (typeof RECAPTCHA_SITE_KEY === "undefined" || !RECAPTCHA_SITE_KEY || RECAPTCHA_SITE_KEY.startsWith("your_")) {
        return null;
    }
    const loaded = await loadRecaptchaScript();
    if (!loaded || typeof grecaptcha === "undefined") {
        return null;
    }
    try {
        const token = await Promise.race([
            new Promise(resolve => {
                grecaptcha.ready(async () => {
                    try {
                        const t = await grecaptcha.execute(RECAPTCHA_SITE_KEY, { action });
                        resolve(t);
                    } catch (e) {
                        console.warn("reCAPTCHA execute error:", e);
                        resolve(null);
                    }
                });
            }),
            new Promise(resolve => setTimeout(() => resolve(null), 4000))
        ]);
        return token;
    } catch (err) {
        console.warn("reCAPTCHA token error:", err);
        return null;
    }
}

/* ============================================
   CONSTANTS & UTILITIES
   ============================================ */
const MONTH_NAMES = [
    "Januari", "Februari", "Maret", "April", "Mei", "Juni",
    "Juli", "Agustus", "September", "Oktober", "November", "Desember"
];

const idDateFormatter = new Intl.DateTimeFormat("id-ID", {
    day: "numeric",
    month: "short",
    year: "numeric"
});

function formatDate(dateInput) {
    if (!dateInput) return "";
    try {
        return idDateFormatter.format(new Date(dateInput));
    } catch (e) {
        return "";
    }
}

function escapeHtml(str) {
    if (!str) return "";
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

/* ============================================
   DISCORD WEBHOOK NOTIFICATIONS (OPTIMIZED)
   ============================================ */
const DISCORD_COLORS = {
    BLUE:   0x007aff, // Kunjungan Web
    GREEN:  0x34c759, // Login sukses & Approve admin
    PURPLE: 0x5856d6, // Register baru
    ORANGE: 0xff9500, // Pengajuan pending
    RED:    0xff3b30, // Reject admin
    GOLD:   0xffcc00  // Ulang tahun hari ini
};

function getFormattedWib() {
    return new Date().toLocaleString("id-ID", {
        timeZone: "Asia/Jakarta",
        dateStyle: "medium",
        timeStyle: "medium"
    }) + " WIB";
}

async function sendDiscordWebhook(targetUrl, { title, description, color, fields = [], footerText }) {
    if (!targetUrl || typeof targetUrl !== "string") return;

    try {
        const payload = {
            username: "Birthday Calendar",
            avatar_url: "https://cdn-icons-png.flaticon.com/512/3135/3135715.png",
            embeds: [
                {
                    title: title,
                    description: description,
                    color: color || DISCORD_COLORS.BLUE,
                    fields: fields,
                    footer: {
                        text: footerText || "Birthday Calendar System"
                    },
                    timestamp: new Date().toISOString()
                }
            ]
        };

        // Fire and forget via non-blocking fetch
        fetch(targetUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        }).catch(err => {
            console.warn("Discord webhook send error:", err);
        });
    } catch (err) {
        console.warn("Discord webhook exception:", err);
    }
}

// 1. Notifikasi Kunjungan Web (Activity Webhook)
function notifyWebsiteVisit() {
    const targetUrl = typeof DISCORD_WEBHOOK_URL !== "undefined" ? DISCORD_WEBHOOK_URL : null;
    if (!targetUrl) return;

    try {
        if (sessionStorage.getItem("bday_cal_visit_notified")) return;
        sessionStorage.setItem("bday_cal_visit_notified", "1");

        let device = "Desktop / PC";
        if (/Mobi|Android|iPhone|iPad|Tablet/i.test(navigator.userAgent)) {
            device = "Smartphone / Mobile";
        }

        sendDiscordWebhook(targetUrl, {
            title: "Pengunjung Membuka Website",
            description: "Ada pengunjung baru yang membuka website Birthday Calendar.",
            color: DISCORD_COLORS.BLUE,
            fields: [
                { name: "Halaman", value: window.location.origin || window.location.href, inline: false },
                { name: "Perangkat", value: device, inline: true },
                { name: "Waktu", value: getFormattedWib(), inline: true }
            ]
        });
    } catch (e) {}
}

// 2. Notifikasi Auth: Login / Register (Activity Webhook)
function notifyUserAuth(type, email) {
    const targetUrl = typeof DISCORD_WEBHOOK_URL !== "undefined" ? DISCORD_WEBHOOK_URL : null;
    if (!targetUrl) return;

    const isLogin = type === "login";
    sendDiscordWebhook(targetUrl, {
        title: isLogin ? "Pengguna Berhasil Masuk (Login)" : "Pengguna Baru Mendaftar (Register)",
        description: isLogin
            ? "Ada pengguna yang berhasil login ke website Birthday Calendar."
            : "Pengguna baru berhasil mendaftar akun.",
        color: isLogin ? DISCORD_COLORS.GREEN : DISCORD_COLORS.PURPLE,
        fields: [
            { name: "Email", value: email, inline: true },
            { name: "Waktu", value: getFormattedWib(), inline: true }
        ]
    });
}

// 3. Notifikasi Pengajuan Ulang Tahun Baru (Activity Webhook)
function notifyNewBirthdaySubmission(name, day, month, userEmail) {
    const targetUrl = typeof DISCORD_WEBHOOK_URL !== "undefined" ? DISCORD_WEBHOOK_URL : null;
    if (!targetUrl) return;

    sendDiscordWebhook(targetUrl, {
        title: "Pengajuan Ulang Tahun Baru",
        description: "Ada data ulang tahun baru yang diajukan oleh pengguna.",
        color: DISCORD_COLORS.ORANGE,
        fields: [
            { name: "Nama", value: name, inline: true },
            { name: "Tanggal", value: `${day} ${MONTH_NAMES[month - 1]}`, inline: true },
            { name: "Diajukan Oleh", value: userEmail, inline: false },
            { name: "Status", value: "Menunggu Persetujuan Admin (Pending)", inline: true },
            { name: "Waktu", value: getFormattedWib(), inline: true }
        ]
    });
}

// 4. Notifikasi Keputusan Admin: Approve / Reject (Activity Webhook)
function notifyAdminDecision(action, birthdayItem) {
    const targetUrl = typeof DISCORD_WEBHOOK_URL !== "undefined" ? DISCORD_WEBHOOK_URL : null;
    if (!targetUrl || !birthdayItem) return;

    const isApproved = action === "approve";
    const adminEmail = currentUser ? currentUser.email : "Admin";

    sendDiscordWebhook(targetUrl, {
        title: isApproved ? "Pengajuan Ulang Tahun Disetujui" : "Pengajuan Ulang Tahun Ditolak",
        description: isApproved
            ? `Admin telah menyetujui pengajuan ulang tahun untuk **${escapeHtml(birthdayItem.name)}**.`
            : `Admin telah menolak pengajuan ulang tahun untuk **${escapeHtml(birthdayItem.name)}**.`,
        color: isApproved ? DISCORD_COLORS.GREEN : DISCORD_COLORS.RED,
        fields: [
            { name: "Nama", value: birthdayItem.name, inline: true },
            { name: "Tanggal", value: `${birthdayItem.day} ${MONTH_NAMES[birthdayItem.month - 1]}`, inline: true },
            { name: "Diajukan Oleh", value: birthdayItem.user_email || "-", inline: false },
            { name: "Diputuskan Oleh", value: adminEmail, inline: true },
            { name: "Status Baru", value: isApproved ? "Disetujui (Approved)" : "Ditolak (Rejected)", inline: true },
            { name: "Waktu", value: getFormattedWib(), inline: false }
        ]
    });
}

// 5. Notifikasi Ulang Tahun Hari Ini (Birthday Webhook - Lacak per ID Orang)
function checkAndNotifyTodayBirthdays(birthdaysList) {
    const targetUrl = typeof DISCORD_BIRTHDAY_WEBHOOK_URL !== "undefined" ? DISCORD_BIRTHDAY_WEBHOOK_URL : null;
    if (!targetUrl || !birthdaysList || birthdaysList.length === 0) return;

    try {
        const today = new Date();
        const todayDay = today.getDate();
        const todayMonth = today.getMonth() + 1;
        const todayKey = `${today.getFullYear()}-${String(todayMonth).padStart(2, '0')}-${String(todayDay).padStart(2, '0')}`;
        const storageKey = `bday_notified_ids_${todayKey}`;

        // Ambil daftar ID orang yang sudah dinotifikasi hari ini
        let notifiedIds = [];
        try {
            notifiedIds = JSON.parse(localStorage.getItem(storageKey) || "[]");
            if (!Array.isArray(notifiedIds)) notifiedIds = [];
        } catch (e) {
            notifiedIds = [];
        }

        // Cari yang ultah hari ini, approved, dan ID-nya BELUM pernah dinotifikasi hari ini
        const newCelebrants = birthdaysList.filter(b =>
            b.status === "approved" &&
            b.day === todayDay &&
            b.month === todayMonth &&
            !notifiedIds.includes(b.id)
        );

        if (!newCelebrants || newCelebrants.length === 0) return;

        // Simpan ID yang baru dikirim ke daftar ID hari ini
        const updatedIds = [...notifiedIds, ...newCelebrants.map(c => c.id)];
        localStorage.setItem(storageKey, JSON.stringify(updatedIds));

        const celebrantsText = newCelebrants.map(c => `• **${escapeHtml(c.name)}**`).join("\n");
        const isFollowUp = notifiedIds.length > 0;

        sendDiscordWebhook(targetUrl, {
            title: isFollowUp ? "Ada Tambahan yang Ulang Tahun Hari Ini!" : "Hari Ini Ada yang Ulang Tahun!",
            description: isFollowUp
                ? `Ada tambahan teman yang baru disetujui dan berulang tahun hari ini (**${todayDay} ${MONTH_NAMES[todayMonth - 1]}**):\n\n${celebrantsText}\n\nYuk berikan ucapan selamat ulang tahun!`
                : `Hari ini, tanggal **${todayDay} ${MONTH_NAMES[todayMonth - 1]}**, ada teman yang sedang berulang tahun:\n\n${celebrantsText}\n\nYuk berikan doa dan ucapan selamat ulang tahun!`,
            color: DISCORD_COLORS.GOLD,
            fields: [
                { name: "Jumlah", value: `${newCelebrants.length} orang`, inline: true },
                { name: "Waktu", value: getFormattedWib(), inline: true }
            ],
            footerText: "Birthday Calendar Reminder"
        });
    } catch (e) {
        console.warn("Error checking today birthdays webhook:", e);
    }
}

/* ============================================
   STATE
   ============================================ */
const now = new Date();
let currentMonth = now.getMonth();
let currentYear  = now.getFullYear();
let currentUser  = null;
let userProfile  = null;
let isAdmin      = false;
let authMode     = "login";

let allBirthdays        = [];
let approvedBirthdays   = [];
let pendingBirthdays    = [];
let monthBirthdaysList  = [];
let userStatusUpdates   = [];
let userStatusLoaded    = false;

// Notification seen keys cached in-memory Set
let seenNotifKeysSet    = null;

// Contacts Directory Sort Mode ("name" | "days")
let directorySortMode   = "name";

/* ============================================
   DOM CACHE
   ============================================ */
const wrapper           = document.querySelector(".wrapper");
const monthLabel        = document.getElementById("month-label");
const daysGrid          = document.getElementById("days-grid");
const legendEl          = document.getElementById("legend");
const themeIcon         = document.getElementById("theme-icon");

// Modals
const addModal          = document.getElementById("add-modal");
const detailModal       = document.getElementById("detail-modal");
const detailTitle       = document.getElementById("detail-title");
const detailList        = document.getElementById("detail-list");
const adminModal        = document.getElementById("admin-modal");
const adminList         = document.getElementById("admin-list");
const authModal         = document.getElementById("auth-modal");
const authModalTitle    = document.getElementById("auth-modal-title");
const historyModal      = document.getElementById("history-modal");
const historyList       = document.getElementById("history-list");
const confirmModal      = document.getElementById("confirm-modal");
const monthPickerModal  = document.getElementById("month-picker-modal");
const monthGrid         = document.getElementById("month-grid");

// Confirm Modal Elements
const confirmCard       = confirmModal ? confirmModal.querySelector(".modal-confirm") : null;
const confirmIconWrap   = confirmModal ? confirmModal.querySelector(".confirm-icon-wrap") : null;
const confirmTitle      = document.getElementById("confirm-title");
const confirmText       = document.getElementById("confirm-text");
const confirmOkBtn      = document.getElementById("confirm-ok-btn");
const confirmCancelBtn  = document.getElementById("confirm-cancel-btn");

// Forms & Inputs
const birthdayForm      = document.getElementById("birthday-form");
const inputName         = document.getElementById("input-name");
const inputMonth        = document.getElementById("input-month");
const inputDay          = document.getElementById("input-day");
const monthPickerBtn    = document.getElementById("month-picker-btn");
const monthPickerText   = document.getElementById("month-picker-text");
const authForm          = document.getElementById("auth-form");
const authEmail         = document.getElementById("auth-email");
const authPassword      = document.getElementById("auth-password");
const authSubmitBtn     = document.getElementById("auth-submit-btn");
const authError         = document.getElementById("auth-error");

// Actions & Badges
const guestActions      = document.getElementById("guest-actions");
const userActions       = document.getElementById("user-actions");
const userEmailEl       = document.getElementById("user-email");
const adminBadge        = document.getElementById("admin-badge");
const adminBtn          = document.getElementById("admin-btn");
const addBtn            = document.getElementById("add-btn");
const pendingCountEl    = document.getElementById("pending-count");
const historyBtn        = document.getElementById("history-btn");
const userPendingCountEl= document.getElementById("user-pending-count");

// Notification Center
const notifBtn          = document.getElementById("notif-btn");
const notifBadge        = document.getElementById("notif-badge");
const notifModal        = document.getElementById("notif-modal");
const tabBtnToday       = document.getElementById("tab-btn-today");
const tabBtnStatus      = document.getElementById("tab-btn-status");
const tabTodayBadge     = document.getElementById("tab-today-badge");
const tabStatusBadge    = document.getElementById("tab-status-badge");
const notifPaneToday    = document.getElementById("notif-pane-today");
const notifPaneStatus   = document.getElementById("notif-pane-status");
const notifTodayList    = document.getElementById("notif-today-list");
const notifStatusList   = document.getElementById("notif-status-list");

// Contacts Directory (A-Z & Countdown)
const directoryBtn         = document.getElementById("directory-btn");
const directoryModal       = document.getElementById("directory-modal");
const directorySearchWrap  = document.querySelector(".directory-search-wrap");
const directorySearchInput = document.getElementById("directory-search-input");
const directoryClearSearch = document.getElementById("directory-clear-search");
const directorySortWrap    = document.querySelector(".directory-sort-wrap");
const directorySortBtn     = document.getElementById("directory-sort-btn");
const directorySortMenu    = document.getElementById("directory-sort-menu");
const directoryList        = document.getElementById("directory-list");
const directorySubtitle    = document.getElementById("directory-subtitle");

/* ============================================
   THEME
   ============================================ */
function initTheme() {
    const saved = localStorage.getItem("birthday-cal-theme");
    if (saved === "dark") {
        document.documentElement.setAttribute("data-theme", "dark");
        themeIcon.innerHTML = ICON.sun;
    } else {
        document.documentElement.removeAttribute("data-theme");
        themeIcon.innerHTML = ICON.moon;
    }
}

function toggleTheme() {
    const isDark = document.documentElement.getAttribute("data-theme") === "dark";
    if (isDark) {
        document.documentElement.removeAttribute("data-theme");
        localStorage.setItem("birthday-cal-theme", "light");
        themeIcon.innerHTML = ICON.moon;
    } else {
        document.documentElement.setAttribute("data-theme", "dark");
        localStorage.setItem("birthday-cal-theme", "dark");
        themeIcon.innerHTML = ICON.sun;
    }
}

/* ============================================
   UI AUTH STATE
   ============================================ */
function updateUIForAuth() {
    if (currentUser) {
        guestActions.classList.add("hidden");
        userActions.classList.remove("hidden");
        userEmailEl.textContent = currentUser.email;
        addBtn.classList.remove("hidden");
        if (historyBtn) historyBtn.classList.remove("hidden");

        if (isAdmin) {
            adminBadge.classList.remove("hidden");
            adminBtn.classList.remove("hidden");
            legendEl.classList.remove("hidden");
        } else {
            adminBadge.classList.add("hidden");
            adminBtn.classList.add("hidden");
            legendEl.classList.add("hidden");
        }
        updateUserPendingBadge();
    } else {
        guestActions.classList.remove("hidden");
        userActions.classList.add("hidden");
        addBtn.classList.add("hidden");
        if (historyBtn) historyBtn.classList.add("hidden");
        adminBtn.classList.add("hidden");
        adminBadge.classList.add("hidden");
        legendEl.classList.add("hidden");
        if (userPendingCountEl) userPendingCountEl.classList.add("hidden");
    }
}

/* ============================================
   MODAL HELPERS (Optimized with { once: true })
   ============================================ */
function openModal(overlay) {
    if (!overlay) return;
    overlay.classList.remove("hidden", "closing");
    overlay.classList.add("opening");
    if (wrapper) wrapper.classList.add("blur-bg");

    overlay.addEventListener("animationend", () => {
        overlay.classList.remove("opening");
    }, { once: true });
}

function closeModal(overlay, callback) {
    if (!overlay || overlay.classList.contains("hidden")) return;
    if (document.activeElement && typeof document.activeElement.blur === "function") {
        document.activeElement.blur();
    }
    overlay.classList.add("closing");
    const card = overlay.querySelector(".modal-fixed, .modal-confirm");

    const finish = () => {
        overlay.classList.remove("closing");
        overlay.classList.add("hidden");
        if (!document.querySelector(".modal-overlay:not(.hidden)")) {
            if (wrapper) wrapper.classList.remove("blur-bg");
        }
        if (callback) callback();
    };

    if (card) {
        card.addEventListener("animationend", () => {
            finish();
        }, { once: true });
    } else {
        finish();
    }
}

/* ============================================
   CONFIRM DIALOG (Optimized DOM Reuse)
   ============================================ */
function showConfirmDialog({ title = "Peringatan", message = "Apakah Anda yakin?", okText = "Keluar", cancelText = "Batalkan", type = "danger", onOk }) {
    if (!confirmModal) return;
    confirmTitle.textContent = title;
    confirmText.textContent = message;

    if (confirmCard) {
        confirmCard.classList.remove("variant-success", "variant-danger");
        confirmCard.classList.add(type === "success" ? "variant-success" : "variant-danger");
    }

    if (confirmIconWrap) {
        confirmIconWrap.innerHTML = type === "success" ? ICON.confirmSuccess : ICON.confirmDanger;
    }

    confirmOkBtn.textContent = okText;
    confirmCancelBtn.textContent = cancelText;

    const cleanup = (cb) => {
        closeModal(confirmModal, () => {
            if (cb) cb();
        });
    };

    confirmOkBtn.onclick = () => {
        cleanup(async () => {
            if (onOk) await onOk();
        });
    };

    confirmCancelBtn.onclick = () => {
        cleanup();
    };

    openModal(confirmModal);
}

/* ============================================
   AUTH
   ============================================ */
function openAuthModal(mode) {
    authMode = mode;
    authModalTitle.textContent = mode === "login" ? "Masuk" : "Daftar";
    authSubmitBtn.textContent  = mode === "login" ? "Masuk" : "Daftar";
    authEmail.value = "";
    authPassword.value = "";
    authError.classList.add("hidden");
    authError.classList.remove("info");

    // Load reCAPTCHA only when opening auth modal as guest
    if (!currentUser) {
        loadRecaptchaScript();
    }

    openModal(authModal);
    setTimeout(() => authEmail.focus(), 150);
}

function closeAuthModal() {
    closeModal(authModal);
}

async function handleAuth(e) {
    e.preventDefault();
    const email    = authEmail.value.trim();
    const password = authPassword.value;
    if (!email || !password) return;

    authSubmitBtn.disabled = true;
    authSubmitBtn.textContent = authMode === "login" ? "Masuk..." : "Mendaftar...";
    authError.classList.add("hidden");
    authError.classList.remove("info");

    try {
        const action = authMode === "login" ? "login" : "register";
        const captchaToken = await getRecaptchaToken(action);
        const authOptions = captchaToken ? { options: { captchaToken } } : {};

        let result;
        if (authMode === "login") {
            result = await db.auth.signInWithPassword({ email, password, ...authOptions });
        } else {
            result = await db.auth.signUp({ email, password, ...authOptions });
        }

        if (result.error) {
            authError.textContent = translateAuthError(result.error.message);
            authError.classList.remove("hidden");
        } else if (authMode === "register" && result.data && result.data.user && !result.data.session) {
            authError.textContent = "Akun dibuat! Cek email untuk konfirmasi, atau matikan Confirm Email di Supabase Dashboard.";
            authError.classList.remove("hidden");
            authError.classList.add("info");
            notifyUserAuth("register", email);
        } else {
            notifyUserAuth(authMode, email);
        }
    } catch (err) {
        authError.textContent = "Terjadi kesalahan: " + err.message;
        authError.classList.remove("hidden");
    }

    authSubmitBtn.disabled = false;
    authSubmitBtn.textContent = authMode === "login" ? "Masuk" : "Daftar";
}

function translateAuthError(msg) {
    if (msg.includes("Invalid login")) return "Email atau password salah.";
    if (msg.includes("already registered")) return "Email sudah terdaftar. Silakan masuk.";
    if (msg.includes("Password should be")) return "Password minimal 6 karakter.";
    if (msg.includes("Email not confirmed")) return "Email belum dikonfirmasi. Cek inbox.";
    if (msg.includes("rate limit")) return "Terlalu banyak percobaan. Coba lagi nanti.";
    return msg;
}

function handleLogout() {
    showConfirmDialog({
        title: "Peringatan",
        message: "Apakah Anda yakin ingin keluar dari akun?",
        okText: "Keluar",
        cancelText: "Batalkan",
        onOk: async () => {
            await db.auth.signOut();
        }
    });
}

async function loadProfile() {
    try {
        const { data, error } = await db
            .from("profiles").select("*").eq("id", currentUser.id).single();

        if (error && error.code === "PGRST116") {
            const { data: newProfile } = await db
                .from("profiles")
                .insert([{ id: currentUser.id, email: currentUser.email, is_admin: false }])
                .select().single();
            userProfile = newProfile;
            isAdmin = false;
        } else if (data) {
            userProfile = data;
            isAdmin = data.is_admin || false;
        } else {
            isAdmin = false;
        }
    } catch (err) {
        console.error("Profile error:", err);
        isAdmin = false;
    }
}

/* ============================================
   CALENDAR (O(1) Day Indexing & Event Delegation)
   ============================================ */
function getDaysInMonth(month, year) {
    return new Date(year, month + 1, 0).getDate();
}

function renderCalendar(direction = "fade") {
    resetGridStyles();
    daysGrid.innerHTML = "";
    monthLabel.textContent = MONTH_NAMES[currentMonth];

    const firstDayOfWeek = new Date(currentYear, currentMonth, 1).getDay();
    const totalDays      = getDaysInMonth(currentMonth, currentYear);
    const todayObj       = new Date();
    const isThisMonth    = todayObj.getMonth() === currentMonth && todayObj.getFullYear() === currentYear;
    const todayDate      = todayObj.getDate();
    const displayMonth   = currentMonth + 1;

    // Pre-index birthday counts for this month: O(N) single pass instead of O(N*31) filters
    const approvedCounts = new Uint8Array(32);
    const pendingCounts  = new Uint8Array(32);

    for (let i = 0; i < approvedBirthdays.length; i++) {
        const b = approvedBirthdays[i];
        if (b.month === displayMonth && b.day >= 1 && b.day <= 31) {
            approvedCounts[b.day]++;
        }
    }

    if (isAdmin) {
        for (let i = 0; i < pendingBirthdays.length; i++) {
            const b = pendingBirthdays[i];
            if (b.month === displayMonth && b.day >= 1 && b.day <= 31) {
                pendingCounts[b.day]++;
            }
        }
    }

    const frag = document.createDocumentFragment();

    // Empty lead cells
    for (let i = 0; i < firstDayOfWeek; i++) {
        const empty = document.createElement("div");
        empty.className = "day-cell empty";
        frag.appendChild(empty);
    }

    // Day cells (event delegation on daysGrid, no per-cell closures)
    for (let d = 1; d <= totalDays; d++) {
        const cell = document.createElement("div");
        cell.className = "day-cell";
        cell.dataset.day = d;

        const num = document.createElement("span");
        num.className = "day-number";
        num.textContent = d;
        if (isThisMonth && d === todayDate) num.classList.add("today");
        cell.appendChild(num);

        const aCount = approvedCounts[d];
        const pCount = pendingCounts[d];

        if (aCount > 0 || pCount > 0) {
            const dotC = document.createElement("div");
            dotC.className = "dot-container";
            if (aCount > 0) {
                const dot = document.createElement("span");
                dot.className = "birthday-dot";
                dotC.appendChild(dot);
            }
            if (pCount > 0) {
                const dot = document.createElement("span");
                dot.className = "birthday-dot pending";
                dotC.appendChild(dot);
            }
            cell.appendChild(dotC);
        }

        frag.appendChild(cell);
    }

    daysGrid.appendChild(frag);

    // CSS transition animation
    daysGrid.classList.remove("calendar-animate-next", "calendar-animate-prev", "calendar-animate-fade");
    monthLabel.classList.remove("calendar-animate-next", "calendar-animate-prev", "calendar-animate-fade");
    void daysGrid.offsetWidth; // Force reflow
    const animClass = direction === "next"
        ? "calendar-animate-next"
        : (direction === "prev" ? "calendar-animate-prev" : "calendar-animate-fade");
    daysGrid.classList.add(animClass);
    monthLabel.classList.add(animClass);
}

function handleDayClick(day, month) {
    if (hasSwiped || isSwiping) return;

    const approved = approvedBirthdays.filter(b => b.day === day && b.month === month);
    const pending  = isAdmin ? pendingBirthdays.filter(b => b.day === day && b.month === month) : [];
    const all = [...approved, ...pending];

    if (all.length > 0) {
        openDetailModal(day, month, all);
    } else if (currentUser) {
        openAddModal(day, month);
    }
}

/* ============================================
   NAVIGATION
   ============================================ */
function prevMonth() {
    currentMonth--;
    if (currentMonth < 0) { currentMonth = 11; currentYear--; }
    renderCalendar("prev");
}

function nextMonth() {
    currentMonth++;
    if (currentMonth > 11) { currentMonth = 0; currentYear++; }
    renderCalendar("next");
}

/* ============================================
   SWIPE GESTURES (Mobile / Touch)
   ============================================ */
let touchStartX = 0;
let touchStartY = 0;
let touchEndX = 0;
let touchEndY = 0;
let touchStartTime = 0;
let isSwiping = false;
let hasSwiped = false;

function resetGridStyles() {
    daysGrid.style.transform = "";
    daysGrid.style.opacity = "";
    daysGrid.style.transition = "";
}

function setupSwipeGestures() {
    if (!daysGrid) return;

    daysGrid.addEventListener("touchstart", (e) => {
        if (e.touches.length !== 1) return;
        const touch = e.touches[0];
        touchStartX = touch.clientX;
        touchStartY = touch.clientY;
        touchEndX = touch.clientX;
        touchEndY = touch.clientY;
        touchStartTime = Date.now();
        isSwiping = false;
        hasSwiped = false;
    }, { passive: true });

    daysGrid.addEventListener("touchmove", (e) => {
        if (e.touches.length !== 1) return;
        const touch = e.touches[0];
        touchEndX = touch.clientX;
        touchEndY = touch.clientY;

        const deltaX = touchEndX - touchStartX;
        const deltaY = touchEndY - touchStartY;

        if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > 12) {
            if (e.cancelable) e.preventDefault();
            isSwiping = true;

            const clampedX = Math.max(-65, Math.min(65, deltaX * 0.45));
            daysGrid.style.transform = `translateX(${clampedX}px)`;
            daysGrid.style.opacity = `${Math.max(0.6, 1 - Math.abs(clampedX) / 200)}`;
            daysGrid.style.transition = "none";
        }
    }, { passive: false });

    const handleTouchEnd = () => {
        if (!isSwiping && !hasSwiped) {
            resetGridStyles();
            return;
        }

        resetGridStyles();

        const deltaX = touchEndX - touchStartX;
        const deltaY = touchEndY - touchStartY;
        const deltaTime = Date.now() - touchStartTime;
        const velocity = Math.abs(deltaX) / (deltaTime || 1);

        const minDistance = 35;
        const isHorizontal = Math.abs(deltaX) > Math.abs(deltaY) * 1.15;
        const isQuickFlick = velocity > 0.25 && Math.abs(deltaX) > 20;

        if (isHorizontal && (Math.abs(deltaX) >= minDistance || isQuickFlick)) {
            hasSwiped = true;
            if (deltaX < 0) {
                nextMonth();
            } else {
                prevMonth();
            }
        }

        setTimeout(() => {
            hasSwiped = false;
            isSwiping = false;
        }, 250);
    };

    daysGrid.addEventListener("touchend", handleTouchEnd, { passive: true });
    daysGrid.addEventListener("touchcancel", handleTouchEnd, { passive: true });
}

/* ============================================
   BIRTHDAY CRUD & STATE SYNCHRONIZATION
   ============================================ */
async function fetchBirthdays() {
    try {
        const { data, error } = await db.from("birthdays").select("*");
        if (error) throw error;
        allBirthdays      = data || [];
        approvedBirthdays = allBirthdays.filter(b => b.status === "approved");
        pendingBirthdays  = allBirthdays.filter(b => b.status === "pending");
    } catch (err) {
        console.error("Fetch error:", err);
        allBirthdays = []; approvedBirthdays = []; pendingBirthdays = [];
    }
    renderCalendar();
    updateNotifBadge();
    updateAdminBadge();
    updateUserPendingBadge();
    if (directoryModal && !directoryModal.classList.contains("hidden")) {
        renderDirectoryList(directorySearchInput ? directorySearchInput.value : "");
    }
    checkAndNotifyTodayBirthdays(allBirthdays);
}

async function saveBirthday(name, day, month) {
    if (!currentUser) return false;
    try {
        const { data, error } = await db.from("birthdays")
            .insert([{ name, day, month, user_id: currentUser.id, user_email: currentUser.email, status: "pending" }])
            .select();
        if (error) throw error;
        if (data && data.length > 0) {
            allBirthdays.push(data[0]);
            pendingBirthdays.push(data[0]);
            userStatusUpdates = [data[0], ...userStatusUpdates.filter(x => x.id !== data[0].id)];
            userStatusLoaded = true;

            notifyNewBirthdaySubmission(name, day, month, currentUser.email);
        }
        renderCalendar();
        updateAdminBadge();
        updateUserPendingBadge();
        updateNotifBadge();
        return true;
    } catch (err) {
        console.error("Save error:", err);
        alert("Gagal menyimpan. Pastikan tabel & RLS sudah di-setup.");
        return false;
    }
}

async function deleteBirthday(id, silent = false) {
    try {
        const { error } = await db.from("birthdays").delete().eq("id", id);
        if (error) throw error;
        allBirthdays      = allBirthdays.filter(b => b.id !== id);
        approvedBirthdays = allBirthdays.filter(b => b.status === "approved");
        pendingBirthdays  = allBirthdays.filter(b => b.status === "pending");
        userStatusUpdates = userStatusUpdates.filter(x => x.id !== id);
        if (!silent) {
            renderCalendar();
            updateNotifBadge();
            updateAdminBadge();
            updateUserPendingBadge();
        }
        return true;
    } catch (err) {
        console.error("Delete error:", err);
        if (!silent) alert("Gagal menghapus.");
        return false;
    }
}

async function approveBirthday(id) {
    try {
        const { error } = await db.from("birthdays").update({ status: "approved" }).eq("id", id);
        if (error) throw error;
        const b = allBirthdays.find(x => x.id === id);
        if (b) {
            b.status = "approved";
            notifyAdminDecision("approve", b);

            // Jika yang disetujui bertepatan dengan hari ini, otomatis umumkan ke webhook ultah hari ini
            const today = new Date();
            if (b.day === today.getDate() && b.month === (today.getMonth() + 1)) {
                checkAndNotifyTodayBirthdays(allBirthdays);
            }
        }
        approvedBirthdays = allBirthdays.filter(x => x.status === "approved");
        pendingBirthdays  = allBirthdays.filter(x => x.status === "pending");
        const s = userStatusUpdates.find(x => x.id === id);
        if (s) s.status = "approved";
        renderCalendar();
        updateNotifBadge();
        updateAdminBadge();
        updateUserPendingBadge();
        return true;
    } catch (err) {
        console.error("Approve error:", err);
        alert("Gagal menyetujui.");
        return false;
    }
}

async function rejectBirthday(b) {
    try {
        const { error } = await db.from("birthdays").update({ status: "rejected" }).eq("id", b.id);
        if (error) throw error;

        const item = allBirthdays.find(x => x.id === b.id);
        if (item) {
            item.status = "rejected";
            notifyAdminDecision("reject", item);
        } else {
            notifyAdminDecision("reject", b);
        }
        approvedBirthdays = allBirthdays.filter(x => x.status === "approved");
        pendingBirthdays  = allBirthdays.filter(x => x.status === "pending");

        const s = userStatusUpdates.find(x => x.id === b.id);
        if (s) s.status = "rejected";

        renderCalendar();
        updateAdminBadge();
        updateUserPendingBadge();
        updateNotifBadge();
        return true;
    } catch (err) {
        console.error("Reject error:", err);
        alert("Gagal menolak pengajuan.");
        return false;
    }
}

function updateAdminBadge() {
    if (!isAdmin) return;
    const c = pendingBirthdays.length;
    if (c > 0) {
        pendingCountEl.textContent = c;
        pendingCountEl.classList.remove("hidden");
    } else {
        pendingCountEl.classList.add("hidden");
    }
}

function updateUserPendingBadge() {
    if (!currentUser || !userPendingCountEl) return;
    const myPending = pendingBirthdays.filter(b => b.user_id === currentUser.id);
    if (myPending.length > 0) {
        userPendingCountEl.textContent = myPending.length;
        userPendingCountEl.classList.remove("hidden");
    } else {
        userPendingCountEl.classList.add("hidden");
    }
}

/* ============================================
   USER STATUS UPDATES (Cached Data Layer)
   ============================================ */
async function fetchUserStatusUpdates(force = false) {
    if (!currentUser) {
        userStatusUpdates = [];
        userStatusLoaded = true;
        return userStatusUpdates;
    }
    if (!force && userStatusLoaded) {
        return userStatusUpdates;
    }

    try {
        const { data, error } = await db.from("birthdays").select("*").eq("user_id", currentUser.id);
        if (error) throw error;
        userStatusUpdates = (data || []).sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
        userStatusLoaded = true;
    } catch (e) {
        console.error("Error fetching status updates:", e);
    }
    return userStatusUpdates;
}

/* ============================================
   NOTIFICATION CENTER & SEEN TRACKING (Set Cached)
   ============================================ */
function getMonthBirthdays() {
    const curMonth = (new Date()).getMonth() + 1;
    return approvedBirthdays.filter(b => b.month === curMonth);
}

function getSeenNotifKeysSet() {
    if (seenNotifKeysSet === null) {
        try {
            const raw = localStorage.getItem("birthday_cal_seen_notifs");
            seenNotifKeysSet = new Set(raw ? JSON.parse(raw) : []);
        } catch (e) {
            seenNotifKeysSet = new Set();
        }
    }
    return seenNotifKeysSet;
}

function addSeenNotifKeys(keys) {
    const set = getSeenNotifKeysSet();
    let changed = false;
    for (let i = 0; i < keys.length; i++) {
        if (!set.has(keys[i])) {
            set.add(keys[i]);
            changed = true;
        }
    }
    if (changed) {
        try {
            const arr = Array.from(set);
            const trimmed = arr.length > 300 ? arr.slice(-300) : arr;
            if (arr.length > 300) seenNotifKeysSet = new Set(trimmed);
            localStorage.setItem("birthday_cal_seen_notifs", JSON.stringify(trimmed));
        } catch (e) {
            console.error("Error saving seen notif keys:", e);
        }
    }
}

function getUnreadNotifCounts() {
    const set = getSeenNotifKeysSet();
    const t = new Date();
    const monthKey = `${t.getFullYear()}_${t.getMonth() + 1}`;

    let unreadMonthCount = 0;
    for (let i = 0; i < monthBirthdaysList.length; i++) {
        if (!set.has(`month_${monthKey}_${monthBirthdaysList[i].id}`)) {
            unreadMonthCount++;
        }
    }

    let unreadStatusCount = 0;
    if (currentUser) {
        for (let i = 0; i < userStatusUpdates.length; i++) {
            const item = userStatusUpdates[i];
            if (!set.has(`status_${item.id}_${item.status}`)) {
                unreadStatusCount++;
            }
        }
    }

    return { unreadMonthCount, unreadStatusCount, total: unreadMonthCount + unreadStatusCount };
}

function markMonthBdayAsSeen() {
    const t = new Date();
    const monthKey = `${t.getFullYear()}_${t.getMonth() + 1}`;
    const keysToMark = monthBirthdaysList.map(b => `month_${monthKey}_${b.id}`);
    if (keysToMark.length > 0) {
        addSeenNotifKeys(keysToMark);
    }
    updateNotifBadgeDisplay();
}

function markStatusAsSeen() {
    if (currentUser && userStatusUpdates.length > 0) {
        const keysToMark = userStatusUpdates.map(item => `status_${item.id}_${item.status}`);
        addSeenNotifKeys(keysToMark);
        updateNotifBadgeDisplay();
    }
}

function updateNotifBadgeDisplay() {
    const { unreadMonthCount, unreadStatusCount, total } = getUnreadNotifCounts();

    if (tabTodayBadge) {
        tabTodayBadge.textContent = unreadMonthCount;
        tabTodayBadge.classList.toggle("hidden", unreadMonthCount === 0);
    }

    if (tabStatusBadge) {
        tabStatusBadge.textContent = unreadStatusCount;
        tabStatusBadge.classList.toggle("hidden", unreadStatusCount === 0);
    }

    if (notifBadge) {
        notifBadge.textContent = total;
        notifBadge.classList.toggle("hidden", total === 0);
    }
}

async function updateNotifBadge() {
    monthBirthdaysList = getMonthBirthdays();
    await fetchUserStatusUpdates();
    updateNotifBadgeDisplay();
}

function openNotifModal(forcedTab) {
    let targetTab = forcedTab;
    const { unreadMonthCount, unreadStatusCount } = getUnreadNotifCounts();

    if (!currentUser) {
        targetTab = forcedTab || "today";
    } else if (!targetTab) {
        if (unreadStatusCount > 0 && unreadMonthCount === 0) {
            targetTab = "status";
        } else {
            targetTab = "today";
        }
    }

    renderNotifPanes();
    switchNotifTab(targetTab);
    openModal(notifModal);
}

function closeNotifModal() {
    closeModal(notifModal);
}

function switchNotifTab(tabName) {
    const isToday = tabName === "today" || tabName === "month";
    tabBtnToday.classList.toggle("active", isToday);
    tabBtnStatus.classList.toggle("active", !isToday);

    notifPaneToday.classList.toggle("active", isToday);
    notifPaneToday.classList.toggle("hidden", !isToday);

    notifPaneStatus.classList.toggle("active", !isToday);
    notifPaneStatus.classList.toggle("hidden", isToday);

    if (isToday) {
        markMonthBdayAsSeen();
    } else {
        markStatusAsSeen();
    }
}

function renderNotifPanes() {
    renderNotifTodayPane();
    renderNotifStatusPane();
}

function renderNotifTodayPane() {
    if (!notifTodayList) return;
    monthBirthdaysList = getMonthBirthdays();

    const t = new Date();
    const thisDay = t.getDate();
    const thisMonth = t.getMonth() + 1;

    if (monthBirthdaysList.length === 0) {
        notifTodayList.innerHTML = `
            <div class="notif-empty-box">
                <div class="notif-empty-icon">
                    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                        <line x1="16" y1="2" x2="16" y2="6"></line>
                        <line x1="8" y1="2" x2="8" y2="6"></line>
                        <line x1="3" y1="10" x2="21" y2="10"></line>
                    </svg>
                </div>
                <span class="notif-empty-title">Tidak Ada Ulang Tahun Bulan Ini</span>
                <span class="notif-empty-desc">Tidak ada yang merayakan ulang tahun pada bulan ${MONTH_NAMES[thisMonth - 1]}.</span>
            </div>
        `;
        return;
    }

    // Sort: Today & Upcoming first (ascending by day), then past (ascending by day)
    const sortedList = [...monthBirthdaysList].sort((a, b) => {
        const diffA = a.day - thisDay;
        const diffB = b.day - thisDay;
        if (diffA >= 0 && diffB < 0) return -1;
        if (diffA < 0 && diffB >= 0) return 1;
        return a.day - b.day;
    });

    let html = "";
    for (let i = 0; i < sortedList.length; i++) {
        const b = sortedList[i];
        const diff = b.day - thisDay;
        const isToday = diff === 0;
        const isPast = diff < 0;

        let pillClass = "bday-upcoming";
        let countdownText = `${diff} hari lagi`;

        if (isToday) {
            pillClass = "bday-today";
            countdownText = "Hari ini";
        } else if (diff === 1) {
            pillClass = "bday-upcoming";
            countdownText = "Besok";
        } else if (isPast) {
            pillClass = "bday-past";
            countdownText = "Sudah lewat";
        }

        html += `
            <div class="notif-bday-card ${isToday ? 'is-today' : ''} ${isPast ? 'is-past' : ''}">
                <div class="notif-bday-top">
                    <span class="notif-bday-name">${escapeHtml(b.name)}</span>
                    <span class="status-pill ${pillClass}">
                        <span class="status-pill-dot"></span>${countdownText}
                    </span>
                </div>
                <div class="notif-bday-bottom">
                    <span class="notif-bday-date">
                        ${ICON.calendar}${b.day} ${MONTH_NAMES[thisMonth - 1]}
                    </span>
                    ${isToday ? '<span class="notif-bday-today-tag">Ulang tahun hari ini</span>' : ''}
                </div>
            </div>
        `;
    }

    notifTodayList.innerHTML = html;
}

function renderNotifStatusPane() {
    if (!notifStatusList) return;

    if (!currentUser) {
        notifStatusList.innerHTML = `
            <div class="notif-guest-card">
                <div class="notif-guest-badge">
                    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"></path>
                        <circle cx="9" cy="7" r="4"></circle>
                        <path d="M22 21v-2a4 4 0 0 0-3-3.87"></path>
                        <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
                    </svg>
                </div>
                <h4 class="notif-guest-title">Masuk untuk Melihat Status</h4>
                <p class="notif-guest-desc">Masuk atau daftar untuk mengajukan ulang tahun dan memantau persetujuan admin secara real-time.</p>
                <div class="notif-guest-actions">
                    <button type="button" class="notif-guest-btn primary" id="notif-login-cta">Masuk</button>
                    <button type="button" class="notif-guest-btn outline" id="notif-register-cta">Daftar Akun</button>
                </div>
            </div>
        `;
        return;
    }

    if (userStatusUpdates.length === 0) {
        notifStatusList.innerHTML = `
            <div class="notif-empty-box">
                <div class="notif-empty-icon">
                    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <circle cx="12" cy="12" r="10"></circle>
                        <polyline points="12 6 12 12 16 14"></polyline>
                    </svg>
                </div>
                <span class="notif-empty-title">Belum Ada Pengajuan</span>
                <span class="notif-empty-desc">Ulang tahun yang Anda ajukan akan muncul di sini beserta status persetujuannya.</span>
            </div>
        `;
        return;
    }

    let html = "";
    for (let i = 0; i < userStatusUpdates.length; i++) {
        const item = userStatusUpdates[i];
        let statusText = "Menunggu";
        let pillClass = "pending-status";
        let descText = "Pengajuan Anda sedang menunggu persetujuan admin.";

        if (item.status === "approved") {
            statusText = "Disetujui";
            pillClass = "approved";
            descText = "Pengajuan Anda telah disetujui dan ditambahkan ke kalender.";
        } else if (item.status === "rejected") {
            statusText = "Ditolak";
            pillClass = "rejected";
            descText = "Pengajuan Anda ditolak oleh admin.";
        }

        const dateStr = item.created_at ? formatDate(item.created_at) : "";

        html += `
            <div class="notif-status-card">
                <div class="notif-status-top">
                    <span class="notif-status-name">${escapeHtml(item.name)}</span>
                    <span class="status-pill ${pillClass}">
                        <span class="status-pill-dot"></span>${statusText}
                    </span>
                </div>
                <div class="notif-status-desc">${descText}</div>
                <div class="notif-status-time">Tanggal Lahir: ${item.day} ${MONTH_NAMES[item.month - 1]}${dateStr ? ' • ' + dateStr : ''}</div>
            </div>
        `;
    }

    notifStatusList.innerHTML = html;
}

/* ============================================
   ADD MODAL & MONTH PICKER (Pre-built DOM)
   ============================================ */
function getMaxDaysInMonth(month) {
    return getDaysInMonth(month - 1, 2024); // Leap year reference allows 29 for Feb
}

function updateDayLimits() {
    const month = parseInt(inputMonth.value, 10) || 1;
    const maxDays = getMaxDaysInMonth(month);
    inputDay.max = maxDays;
    inputDay.min = 1;

    const val = parseInt(inputDay.value, 10);
    if (val > maxDays) {
        inputDay.value = maxDays;
    } else if (val < 1 && inputDay.value !== "") {
        inputDay.value = 1;
    }
}

function setSelectedMonth(monthNum) {
    inputMonth.value = monthNum;
    if (monthPickerText) {
        monthPickerText.textContent = MONTH_NAMES[monthNum - 1];
    }
    updateDayLimits();
}

function initMonthGrid() {
    if (!monthGrid) return;
    const frag = document.createDocumentFragment();
    for (let i = 0; i < MONTH_NAMES.length; i++) {
        const m = i + 1;
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "month-grid-item";
        btn.dataset.month = m;
        const numStr = m < 10 ? "0" + m : "" + m;
        btn.innerHTML = `
            <span class="month-item-num">${numStr}</span>
            <span class="month-item-name">${MONTH_NAMES[i]}</span>
        `;
        frag.appendChild(btn);
    }
    monthGrid.appendChild(frag);

    // Event delegation on monthGrid
    monthGrid.addEventListener("click", (e) => {
        const btn = e.target.closest(".month-grid-item");
        if (!btn) return;
        const m = parseInt(btn.dataset.month, 10);
        if (m) {
            setSelectedMonth(m);
            closeMonthPicker();
        }
    });
}

function openMonthPicker() {
    const currentSelected = parseInt(inputMonth.value, 10) || 1;
    const items = monthGrid.children;
    for (let i = 0; i < items.length; i++) {
        const m = parseInt(items[i].dataset.month, 10);
        items[i].classList.toggle("active", m === currentSelected);
    }
    openModal(monthPickerModal);
}

function closeMonthPicker() {
    closeModal(monthPickerModal);
}

function openAddModal(preDay, preMonth) {
    if (!currentUser) { openAuthModal("login"); return; }
    const today = new Date();
    const selMonth = preMonth !== undefined ? preMonth : (today.getMonth() + 1);
    const selDay   = preDay !== undefined ? preDay : today.getDate();

    inputName.value = "";
    setSelectedMonth(selMonth);
    inputDay.value = selDay;
    updateDayLimits();

    openModal(addModal);
    setTimeout(() => inputName.focus(), 150);
}

function closeAddModal() {
    closeModal(addModal);
}

/* ============================================
   DETAIL MODAL (Day Click View)
   ============================================ */
let activeDetailItems = [];

function openDetailModal(day, month, items) {
    detailTitle.textContent = `${day} ${MONTH_NAMES[month - 1]}`;
    activeDetailItems = items || [];
    renderDetailList(day, month);
    openModal(detailModal);
}

function renderDetailList(day, month) {
    if (!detailList) return;

    if (activeDetailItems.length === 0) {
        detailList.innerHTML = '<div class="detail-empty">Tidak ada ulang tahun.</div>';
        return;
    }

    let html = "";
    for (let i = 0; i < activeDetailItems.length; i++) {
        const b = activeDetailItems[i];
        const canDelete = currentUser && (b.user_id === currentUser.id || isAdmin);

        html += `
            <div class="detail-item" data-id="${b.id}" data-name="${escapeHtml(b.name)}">
                <div class="detail-name-wrap">
                    <span class="detail-name">${escapeHtml(b.name)}</span>
                    ${isAdmin ? `<span class="status-badge ${b.status === 'approved' ? 'approved' : 'pending-status'}">${b.status === 'approved' ? 'OK' : 'Pending'}</span>` : ''}
                </div>
                ${canDelete ? '<button type="button" class="delete-btn">Hapus</button>' : ''}
            </div>
        `;
    }

    if (currentUser) {
        html += `<button type="button" class="add-more-btn" data-day="${day}" data-month="${month}">+ Tambah lagi</button>`;
    }

    detailList.innerHTML = html;
}

function closeDetailModal() {
    closeModal(detailModal);
}

/* ============================================
   ADMIN PANEL MODAL
   ============================================ */
function openAdminModal() {
    renderAdminList();
    openModal(adminModal);
}

function renderAdminList() {
    if (!adminList) return;

    if (pendingBirthdays.length === 0) {
        adminList.innerHTML = '<div class="admin-empty">Tidak ada yang menunggu persetujuan.</div>';
        return;
    }

    let html = "";
    for (let i = 0; i < pendingBirthdays.length; i++) {
        const b = pendingBirthdays[i];
        html += `
            <div class="admin-item" data-id="${b.id}">
                <div class="admin-item-info">
                    <div class="admin-item-top">
                        <span class="admin-item-name">${escapeHtml(b.name)}</span>
                        <span class="admin-item-date">${b.day} ${MONTH_NAMES[b.month - 1]}</span>
                    </div>
                    <span class="admin-item-email">oleh: ${escapeHtml(b.user_email)}</span>
                </div>
                <div class="admin-item-actions">
                    <button type="button" class="approve-btn" title="Setujui" data-action="approve" data-id="${b.id}">${ICON.check}</button>
                    <button type="button" class="reject-btn" title="Tolak" data-action="reject" data-id="${b.id}">${ICON.cross}</button>
                </div>
            </div>
        `;
    }
    adminList.innerHTML = html;
}

function closeAdminModal() {
    closeModal(adminModal);
}

/* ============================================
   MEMBER REQUEST HISTORY MODAL
   ============================================ */
async function openHistoryModal() {
    if (!currentUser || !historyList) return;
    openModal(historyModal);

    if (userStatusLoaded) {
        renderHistoryList(userStatusUpdates);
    } else {
        historyList.innerHTML = `
            <div class="history-loading">
                <div class="history-spinner"></div>
                <span>Memuat riwayat...</span>
            </div>
        `;
        const items = await fetchUserStatusUpdates();
        renderHistoryList(items);
    }
    markStatusAsSeen();
}

function renderHistoryList(items) {
    if (!historyList) return;

    if (!items || items.length === 0) {
        historyList.innerHTML = '<div class="detail-empty">Belum ada pengajuan ulang tahun.</div>';
        updateUserPendingBadge();
        return;
    }

    let html = "";
    for (let i = 0; i < items.length; i++) {
        const b = items[i];
        let pillClass = "pending-status";
        let pillText = "Menunggu";
        if (b.status === "approved") {
            pillClass = "approved";
            pillText = "Disetujui";
        } else if (b.status === "rejected") {
            pillClass = "rejected";
            pillText = "Ditolak";
        }

        const dateStr = b.created_at ? formatDate(b.created_at) : "";
        const isRejected = b.status === "rejected";

        html += `
            <div class="history-card" data-id="${b.id}">
                <div class="history-card-top">
                    <span class="history-name">${escapeHtml(b.name)}</span>
                    <span class="status-pill ${pillClass}">
                        <span class="status-pill-dot"></span>${pillText}
                    </span>
                </div>
                <div class="history-card-bottom">
                    <div class="history-meta">
                        <span class="history-bday">
                            ${ICON.calendar}${b.day} ${MONTH_NAMES[b.month - 1]}
                        </span>
                        ${dateStr ? `<span class="history-time">Diajukan: ${dateStr}</span>` : ''}
                    </div>
                    <button type="button" class="history-del-btn" title="${isRejected ? 'Hapus Riwayat Penolakan' : 'Hapus Ulang Tahun'}" data-action="delete" data-id="${b.id}" data-name="${escapeHtml(b.name)}">
                        ${ICON.trash}Hapus
                    </button>
                </div>
            </div>
        `;
    }

    historyList.innerHTML = html;
    updateUserPendingBadge();
}

function closeHistoryModal() {
    closeModal(historyModal);
}

/* ============================================
   CONTACTS DIRECTORY (A-Z & SEARCH)
   ============================================ */
function calculateDaysUntilNextBirthday(day, month) {
    const today = new Date();
    const todayMid = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    let bdayMid = new Date(today.getFullYear(), month - 1, day);
    if (bdayMid < todayMid) {
        bdayMid = new Date(today.getFullYear() + 1, month - 1, day);
    }
    const diffMs = bdayMid.getTime() - todayMid.getTime();
    return Math.round(diffMs / (1000 * 60 * 60 * 24));
}

function initDirectorySort() {
    const saved = localStorage.getItem("birthday-cal-directory-sort");
    if (saved === "days" || saved === "name") {
        directorySortMode = saved;
    }
    updateSortUI();
}

function toggleSortMenu() {
    if (!directorySortMenu) return;
    const isHidden = directorySortMenu.classList.contains("hidden");
    if (isHidden) {
        directorySortMenu.classList.remove("hidden");
        if (directorySortBtn) directorySortBtn.setAttribute("aria-expanded", "true");
    } else {
        closeSortMenu();
    }
}

function closeSortMenu() {
    if (directorySortMenu && !directorySortMenu.classList.contains("hidden")) {
        directorySortMenu.classList.add("hidden");
        if (directorySortBtn) directorySortBtn.setAttribute("aria-expanded", "false");
    }
}

function setDirectorySort(mode) {
    if (mode !== "name" && mode !== "days") return;
    directorySortMode = mode;
    try {
        localStorage.setItem("birthday-cal-directory-sort", mode);
    } catch (e) {}
    updateSortUI();
    closeSortMenu();
    renderDirectoryList(directorySearchInput ? directorySearchInput.value : "");
}

function updateSortUI() {
    if (directorySortBtn) {
        directorySortBtn.classList.toggle("active", directorySortMode === "days");
        directorySortBtn.title = directorySortMode === "days" ? "Urutkan: Berapa hari lagi" : "Urutkan: Nama (A-Z)";
    }
    const items = document.querySelectorAll(".sort-menu-item");
    items.forEach(el => {
        const isMatch = el.dataset.sort === directorySortMode;
        el.classList.toggle("active", isMatch);
        const check = el.querySelector(".sort-check-icon");
        if (check) check.classList.toggle("hidden", !isMatch);
    });
}

function renderDirectoryCard(b) {
    const diffDays = calculateDaysUntilNextBirthday(b.day, b.month);
    const isToday = diffDays === 0;

    let pillClass = "bday-upcoming";
    let countdownText = `${diffDays} hari lagi`;
    if (isToday) {
        pillClass = "bday-today";
        countdownText = "Hari ini";
    } else if (diffDays === 1) {
        pillClass = "bday-upcoming";
        countdownText = "Besok";
    }

    const initial = (b.name[0] || "?").toUpperCase();

    return `
        <div class="directory-card ${isToday ? 'is-today' : ''}" data-day="${b.day}" data-month="${b.month}">
            <div class="directory-card-left">
                <div class="directory-avatar">${initial}</div>
                <div class="directory-info">
                    <span class="directory-name">${escapeHtml(b.name)}</span>
                    <span class="directory-date">
                        ${ICON.calendar}${b.day} ${MONTH_NAMES[b.month - 1]}
                    </span>
                </div>
            </div>
            <div class="directory-card-right">
                <span class="status-pill ${pillClass}">
                    <span class="status-pill-dot"></span>${countdownText}
                </span>
            </div>
        </div>
    `;
}

function openDirectoryModal() {
    if (directorySearchInput) directorySearchInput.value = "";
    if (directoryClearSearch) directoryClearSearch.classList.add("hidden");
    if (directorySearchWrap) directorySearchWrap.classList.remove("is-focus-visible");
    closeSortMenu();
    updateSortUI();
    renderDirectoryList();
    openModal(directoryModal);
    setTimeout(() => {
        if (directorySearchInput) directorySearchInput.focus();
    }, 150);
}

function closeDirectoryModal() {
    closeSortMenu();
    closeModal(directoryModal);
}

function renderDirectoryList(query = "") {
    if (!directoryList) return;

    const q = query.trim().toLowerCase();
    let items = approvedBirthdays.slice();

    if (q) {
        items = items.filter(b => 
            b.name.toLowerCase().includes(q) || 
            MONTH_NAMES[b.month - 1].toLowerCase().includes(q) ||
            `${b.day} ${MONTH_NAMES[b.month - 1]}`.toLowerCase().includes(q)
        );
    }

    // Update subtitle
    const sortLabel = directorySortMode === "days" ? "Urutan hari terdekat" : "Urutan nama A-Z";
    if (directorySubtitle) {
        if (q) {
            directorySubtitle.textContent = `${items.length} hasil ditemukan • ${sortLabel}`;
        } else {
            directorySubtitle.textContent = `${approvedBirthdays.length} orang terdaftar • ${sortLabel}`;
        }
    }

    if (approvedBirthdays.length === 0) {
        directoryList.innerHTML = `
            <div class="directory-empty-box">
                <div class="directory-empty-icon">
                    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                        <circle cx="9" cy="7" r="4"></circle>
                    </svg>
                </div>
                <span class="directory-empty-title">Belum Ada Ulang Tahun</span>
                <span class="directory-empty-desc">Ulang tahun yang disetujui akan muncul dalam daftar ini.</span>
            </div>
        `;
        return;
    }

    if (items.length === 0) {
        directoryList.innerHTML = `
            <div class="directory-empty-box">
                <div class="directory-empty-icon">
                    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <circle cx="11" cy="11" r="8"></circle>
                        <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                    </svg>
                </div>
                <span class="directory-empty-title">Tidak Ada Hasil</span>
                <span class="directory-empty-desc">Tidak ditemukan nama yang cocok dengan "${escapeHtml(query)}".</span>
            </div>
        `;
        return;
    }

    let html = "";

    if (directorySortMode === "days") {
        // Sort ascending by days until next birthday, then alphabetically by name
        items.sort((a, b) => {
            const daysA = calculateDaysUntilNextBirthday(a.day, a.month);
            const daysB = calculateDaysUntilNextBirthday(b.day, b.month);
            if (daysA !== daysB) return daysA - daysB;
            return a.name.localeCompare(b.name, "id", { sensitivity: "base" });
        });

        // Group into intuitive time categories
        const categories = [
            { key: "today", title: "Hari Ini" },
            { key: "week", title: "Minggu Ini" },
            { key: "month", title: "Bulan Ini" },
            { key: "later", title: "Mendatang" }
        ];

        const grouped = { today: [], week: [], month: [], later: [] };
        items.forEach(b => {
            const diff = calculateDaysUntilNextBirthday(b.day, b.month);
            if (diff === 0) {
                grouped.today.push(b);
            } else if (diff <= 7) {
                grouped.week.push(b);
            } else if (diff <= 30) {
                grouped.month.push(b);
            } else {
                grouped.later.push(b);
            }
        });

        categories.forEach(cat => {
            const list = grouped[cat.key];
            if (!list || list.length === 0) return;

            html += `
                <div class="directory-group">
                    <div class="directory-group-header">${cat.title} (${list.length})</div>
            `;

            list.forEach(b => {
                html += renderDirectoryCard(b);
            });

            html += `</div>`;
        });
    } else {
        // Sort A-Z by name
        items.sort((a, b) => a.name.localeCompare(b.name, "id", { sensitivity: "base" }));

        // Group by first letter
        const groups = {};
        items.forEach(b => {
            const firstChar = (b.name[0] || "#").toUpperCase();
            const letter = /[A-Z]/.test(firstChar) ? firstChar : "#";
            if (!groups[letter]) groups[letter] = [];
            groups[letter].push(b);
        });

        const sortedLetters = Object.keys(groups).sort((a, b) => {
            if (a === "#") return 1;
            if (b === "#") return -1;
            return a.localeCompare(b);
        });

        sortedLetters.forEach(letter => {
            html += `
                <div class="directory-group">
                    <div class="directory-group-header">${letter}</div>
            `;

            groups[letter].forEach(b => {
                html += renderDirectoryCard(b);
            });

            html += `</div>`;
        });
    }

    directoryList.innerHTML = html;
}

/* ============================================
   EVENT LISTENERS SETUP (Optimized Delegation)
   ============================================ */
function setupListeners() {
    // Auth Trigger Buttons
    document.getElementById("login-btn").addEventListener("click", () => openAuthModal("login"));
    document.getElementById("register-btn").addEventListener("click", () => openAuthModal("register"));
    document.getElementById("logout-btn").addEventListener("click", handleLogout);

    // Auth Modal Form & Close
    authForm.addEventListener("submit", handleAuth);
    document.querySelector(".auth-close-btn").addEventListener("click", closeAuthModal);

    // Navigation Buttons & Swipe Gestures
    document.getElementById("prev-btn").addEventListener("click", prevMonth);
    document.getElementById("next-btn").addEventListener("click", nextMonth);
    setupSwipeGestures();

    // Event Delegation: Days Grid Day Click
    daysGrid.addEventListener("click", (e) => {
        if (hasSwiped || isSwiping) return;
        const cell = e.target.closest(".day-cell:not(.empty)");
        if (!cell) return;
        const day = parseInt(cell.dataset.day, 10);
        if (day) handleDayClick(day, currentMonth + 1);
    });

    // Theme Toggle
    document.getElementById("theme-btn").addEventListener("click", toggleTheme);

    // Add Birthday Modal Trigger & Close
    addBtn.addEventListener("click", () => openAddModal());
    document.querySelector(".modal-close-btn").addEventListener("click", closeAddModal);

    // Month Picker Modal Trigger & Close
    if (monthPickerBtn) monthPickerBtn.addEventListener("click", openMonthPicker);
    const monthPickerCloseBtn = document.querySelector(".month-picker-close-btn");
    if (monthPickerCloseBtn) monthPickerCloseBtn.addEventListener("click", closeMonthPicker);

    // Input Day Constraints
    inputDay.addEventListener("input", updateDayLimits);
    inputDay.addEventListener("blur", updateDayLimits);

    // Detail Modal Close & Delegation
    document.querySelector(".detail-close-btn").addEventListener("click", closeDetailModal);
    detailList.addEventListener("click", (e) => {
        const delBtn = e.target.closest(".delete-btn");
        if (delBtn) {
            const item = delBtn.closest(".detail-item");
            if (!item) return;
            const id = parseInt(item.dataset.id, 10);
            const name = item.dataset.name || "ulang tahun ini";

            showConfirmDialog({
                title: "Hapus Ulang Tahun",
                message: `Hapus ulang tahun ${name}?`,
                okText: "Hapus",
                cancelText: "Batalkan",
                onOk: async () => {
                    const ok = await deleteBirthday(id);
                    if (ok) {
                        activeDetailItems = activeDetailItems.filter(x => x.id !== id);
                        item.remove();
                        if (detailList.querySelectorAll(".detail-item").length === 0) {
                            closeDetailModal();
                        }
                    }
                }
            });
            return;
        }

        const addMore = e.target.closest(".add-more-btn");
        if (addMore) {
            const d = parseInt(addMore.dataset.day, 10);
            const m = parseInt(addMore.dataset.month, 10);
            closeDetailModal();
            openAddModal(d, m);
        }
    });

    // Admin Modal Trigger, Close & Delegation
    adminBtn.addEventListener("click", openAdminModal);
    document.querySelector(".admin-modal-close-btn").addEventListener("click", closeAdminModal);
    adminList.addEventListener("click", (e) => {
        const approveBtn = e.target.closest(".approve-btn");
        if (approveBtn) {
            const id = parseInt(approveBtn.dataset.id, 10);
            const b = pendingBirthdays.find(x => x.id === id);
            if (!b) return;

            showConfirmDialog({
                title: "Setujui Permintaan",
                message: `Anda yakin ingin menambah ulang tahun "${b.name}" ke kalender?`,
                okText: "Setujui",
                cancelText: "Batalkan",
                type: "success",
                onOk: async () => {
                    const ok = await approveBirthday(id);
                    if (ok) renderAdminList();
                }
            });
            return;
        }

        const rejectBtn = e.target.closest(".reject-btn");
        if (rejectBtn) {
            const id = parseInt(rejectBtn.dataset.id, 10);
            const b = pendingBirthdays.find(x => x.id === id);
            if (!b) return;

            showConfirmDialog({
                title: "Tolak Permintaan",
                message: `Tolak pengajuan ulang tahun "${b.name}"?`,
                okText: "Tolak",
                cancelText: "Batalkan",
                type: "danger",
                onOk: async () => {
                    const ok = await rejectBirthday(b);
                    if (ok) renderAdminList();
                }
            });
        }
    });

    // Member Request History Modal Trigger, Close & Delegation
    if (historyBtn) historyBtn.addEventListener("click", openHistoryModal);
    const historyCloseBtn = document.querySelector(".history-close-btn");
    if (historyCloseBtn) historyCloseBtn.addEventListener("click", closeHistoryModal);
    historyList.addEventListener("click", (e) => {
        const delBtn = e.target.closest(".history-del-btn");
        if (!delBtn) return;

        const id = parseInt(delBtn.dataset.id, 10);
        const name = delBtn.dataset.name || "";
        const item = userStatusUpdates.find(x => x.id === id);
        const isRejected = item && item.status === "rejected";

        showConfirmDialog({
            title: isRejected ? "Hapus Riwayat Penolakan" : "Hapus Ulang Tahun",
            message: isRejected
                ? `Hapus riwayat pengajuan ditolak "${name}"?`
                : `Hapus data ulang tahun "${name}"? Data ini juga akan terhapus dari kalender.`,
            okText: "Hapus",
            cancelText: "Batalkan",
            type: "danger",
            onOk: async () => {
                const ok = await deleteBirthday(id);
                if (ok) {
                    renderHistoryList(userStatusUpdates);
                    updateUserPendingBadge();
                    updateNotifBadge();
                }
            }
        });
    });

    // Notification Center Trigger, Close & Tabs
    if (notifBtn) notifBtn.addEventListener("click", () => openNotifModal());
    const notifCloseBtn = document.querySelector(".notif-close-btn");
    if (notifCloseBtn) notifCloseBtn.addEventListener("click", closeNotifModal);
    if (tabBtnToday) tabBtnToday.addEventListener("click", () => switchNotifTab("today"));
    if (tabBtnStatus) tabBtnStatus.addEventListener("click", () => switchNotifTab("status"));

    // Notification Status Guest CTA Delegation
    notifStatusList.addEventListener("click", (e) => {
        if (e.target.closest("#notif-login-cta")) {
            closeNotifModal();
            openAuthModal("login");
        } else if (e.target.closest("#notif-register-cta")) {
            closeNotifModal();
            openAuthModal("register");
        }
    });

    // Contacts Directory Modal Trigger, Close & Search
    if (directoryBtn) directoryBtn.addEventListener("click", openDirectoryModal);
    const directoryCloseBtn = document.querySelector(".directory-close-btn");
    if (directoryCloseBtn) directoryCloseBtn.addEventListener("click", closeDirectoryModal);

    if (directorySearchInput) {
        directorySearchInput.addEventListener("input", () => {
            const val = directorySearchInput.value;
            if (directoryClearSearch) {
                directoryClearSearch.classList.toggle("hidden", val.length === 0);
            }
            renderDirectoryList(val);
        });

        if (directorySearchWrap) {
            directorySearchInput.addEventListener("focus", () => {
                try {
                    if (directorySearchInput.matches(":focus-visible")) {
                        directorySearchWrap.classList.add("is-focus-visible");
                    }
                } catch (e) {}
            });
            directorySearchInput.addEventListener("blur", () => {
                directorySearchWrap.classList.remove("is-focus-visible");
            });
            directorySearchInput.addEventListener("keydown", (e) => {
                if (e.key === "Tab") {
                    directorySearchWrap.classList.remove("is-focus-visible");
                }
            });
        }
    }

    if (directoryClearSearch) {
        directoryClearSearch.addEventListener("click", () => {
            directorySearchInput.value = "";
            directoryClearSearch.classList.add("hidden");
            renderDirectoryList("");
            directorySearchInput.focus();
        });
    }

    // Contacts Directory Sort Button & Menu Delegation
    if (directorySortBtn) {
        directorySortBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            toggleSortMenu();
        });
    }

    if (directorySortMenu) {
        directorySortMenu.addEventListener("click", (e) => {
            const item = e.target.closest(".sort-menu-item");
            if (item && item.dataset.sort) {
                setDirectorySort(item.dataset.sort);
            }
        });
    }

    // Close sort menu on click outside
    document.addEventListener("click", (e) => {
        if (directorySortWrap && !directorySortWrap.contains(e.target)) {
            closeSortMenu();
        }
    });

    // Directory Card Click: view day detail
    if (directoryList) {
        directoryList.addEventListener("click", (e) => {
            const card = e.target.closest(".directory-card");
            if (!card) return;
            const day = parseInt(card.dataset.day, 10);
            const month = parseInt(card.dataset.month, 10);
            if (day && month) {
                closeDirectoryModal();
                const dayItems = approvedBirthdays.filter(x => x.day === day && x.month === month);
                openDetailModal(day, month, dayItems);
            }
        });
    }

    // Birthday Form Submit
    birthdayForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const name = inputName.value.trim();
        const day  = parseInt(inputDay.value, 10);
        const month = parseInt(inputMonth.value, 10);
        if (!name) { inputName.focus(); return; }

        const btn = birthdayForm.querySelector(".submit-btn");
        btn.disabled = true; btn.textContent = "Menyimpan...";
        const ok = await saveBirthday(name, day, month);
        btn.disabled = false; btn.textContent = "Simpan";
        if (ok) {
            closeAddModal();
            updateUserPendingBadge();
            updateNotifBadge();
            openNotifModal("status");
        }
    });

    // Unified Modal Backdrop Click Handler
    document.querySelectorAll(".modal-overlay").forEach(overlay => {
        overlay.addEventListener("click", (e) => {
            if (e.target === overlay) {
                if (overlay === confirmModal) {
                    confirmCancelBtn.click();
                } else {
                    closeModal(overlay);
                }
            }
        });
    });

    // Unified Escape Key Handler
    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
            if (directorySortMenu && !directorySortMenu.classList.contains("hidden")) {
                closeSortMenu();
                return;
            }
            if (document.activeElement && typeof document.activeElement.blur === "function") {
                document.activeElement.blur();
            }
            if (confirmModal && !confirmModal.classList.contains("hidden")) {
                confirmCancelBtn.click();
                return;
            }
            const activeModal = document.querySelector(".modal-overlay:not(.hidden)");
            if (activeModal) closeModal(activeModal);
        }
    });
}

/* ============================================
   INITIALIZATION
   ============================================ */
async function init() {
    initTheme();
    initDirectorySort();
    initMonthGrid();
    setSelectedMonth(now.getMonth() + 1);
    updateDayLimits();
    setupListeners();
    renderCalendar();
    notifyWebsiteVisit();

    // Supabase Auth State Observer
    db.auth.onAuthStateChange(async (event, session) => {
        console.log("Auth:", event);
        if (session && session.user) {
            currentUser = session.user;
            await loadProfile();
            updateUIForAuth();
            closeAuthModal();
            await fetchBirthdays();
        } else {
            currentUser = null;
            userProfile = null;
            isAdmin = false;
            userStatusLoaded = false;
            updateUIForAuth();
            await fetchBirthdays();
        }
    });
}

document.addEventListener("DOMContentLoaded", init);
