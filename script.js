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

   -- 3. Birthdays table
   CREATE TABLE birthdays (
       id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
       name TEXT NOT NULL,
       day SMALLINT NOT NULL CHECK (day >= 1 AND day <= 31),
       month SMALLINT NOT NULL CHECK (month >= 1 AND month <= 12),
       user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
       user_email TEXT NOT NULL,
       status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved')),
       created_at TIMESTAMPTZ DEFAULT NOW()
   );
   ALTER TABLE birthdays ENABLE ROW LEVEL SECURITY;

   -- Anon users can read approved only
   CREATE POLICY "Anon read approved" ON birthdays FOR SELECT TO anon USING (status = 'approved');

   -- Authenticated: approved + own pending + admin sees all
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
   CONFIGURATION
   Kredensial dimuat dari config.js (gitignored).
   Lihat config.example.js untuk template.
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
   SVG ICONS (no emoji)
   ============================================ */
const ICON = {
    moon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>',

    sun: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>',

    check: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',

    cross: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>'
};

/* ============================================
   RECAPTCHA v3 HELPER
   ============================================ */
async function getRecaptchaToken(action) {
    if (typeof grecaptcha === "undefined" || !RECAPTCHA_SITE_KEY || RECAPTCHA_SITE_KEY.startsWith("your_")) {
        return null; // reCAPTCHA not configured, skip
    }
    try {
        await new Promise(resolve => grecaptcha.ready(resolve));
        return await grecaptcha.execute(RECAPTCHA_SITE_KEY, { action });
    } catch (err) {
        console.error("reCAPTCHA error:", err);
        return null;
    }
}

/* ============================================
   CONSTANTS
   ============================================ */
const MONTH_NAMES = [
    "Januari", "Februari", "Maret", "April", "Mei", "Juni",
    "Juli", "Agustus", "September", "Oktober", "November", "Desember"
];

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
let allBirthdays     = [];
let approvedBirthdays = [];
let pendingBirthdays  = [];

/* ============================================
   DOM REFERENCES
   ============================================ */
const monthLabel      = document.getElementById("month-label");
const daysGrid        = document.getElementById("days-grid");
const notification    = document.getElementById("notification");
const notificationText= document.getElementById("notification-text");
const legendEl        = document.getElementById("legend");
const addModal        = document.getElementById("add-modal");
const detailModal     = document.getElementById("detail-modal");
const detailTitle     = document.getElementById("detail-title");
const detailList      = document.getElementById("detail-list");
const adminModal      = document.getElementById("admin-modal");
const adminList       = document.getElementById("admin-list");
const authModal       = document.getElementById("auth-modal");
const authModalTitle  = document.getElementById("auth-modal-title");
const birthdayForm    = document.getElementById("birthday-form");
const inputName       = document.getElementById("input-name");
const inputMonth      = document.getElementById("input-month");
const inputDay        = document.getElementById("input-day");
const themeIcon       = document.getElementById("theme-icon");
const authForm        = document.getElementById("auth-form");
const authEmail       = document.getElementById("auth-email");
const authPassword    = document.getElementById("auth-password");
const authSubmitBtn   = document.getElementById("auth-submit-btn");
const authError       = document.getElementById("auth-error");
const guestActions    = document.getElementById("guest-actions");
const userActions     = document.getElementById("user-actions");
const userEmailEl     = document.getElementById("user-email");
const adminBadge      = document.getElementById("admin-badge");
const adminBtn        = document.getElementById("admin-btn");
const addBtn          = document.getElementById("add-btn");
const pendingCountEl  = document.getElementById("pending-count");
const historyBtn          = document.getElementById("history-btn");
const userPendingCountEl  = document.getElementById("user-pending-count");
const historyModal        = document.getElementById("history-modal");
const historyList         = document.getElementById("history-list");
const confirmModal        = document.getElementById("confirm-modal");
const monthPickerBtn      = document.getElementById("month-picker-btn");
const monthPickerText     = document.getElementById("month-picker-text");
const monthPickerModal    = document.getElementById("month-picker-modal");
const monthGrid           = document.getElementById("month-grid");

// Notification Center
const notifBtn            = document.getElementById("notif-btn");
const notifBadge          = document.getElementById("notif-badge");
const notifModal          = document.getElementById("notif-modal");
const tabBtnToday         = document.getElementById("tab-btn-today");
const tabBtnStatus        = document.getElementById("tab-btn-status");
const tabTodayBadge       = document.getElementById("tab-today-badge");
const tabStatusBadge      = document.getElementById("tab-status-badge");
const notifPaneToday      = document.getElementById("notif-pane-today");
const notifPaneStatus     = document.getElementById("notif-pane-status");
const notifTodayList      = document.getElementById("notif-today-list");
const notifStatusList     = document.getElementById("notif-status-list");

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
   UI STATE
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
   MODAL HELPERS (smooth open/close)
   ============================================ */
function openModal(overlay) {
    overlay.classList.remove("hidden", "closing");
    overlay.classList.add("opening");
    const wrapper = document.querySelector(".wrapper");
    if (wrapper) wrapper.classList.add("blur-bg");
    overlay.addEventListener("animationend", function handler() {
        overlay.classList.remove("opening");
        overlay.removeEventListener("animationend", handler);
    });
}

function closeModal(overlay, callback) {
    if (overlay.classList.contains("hidden")) return;
    if (document.activeElement && document.activeElement.blur) {
        document.activeElement.blur();
    }
    overlay.classList.add("closing");
    const card = overlay.querySelector(".modal-fixed, .modal-confirm");

    const finish = () => {
        overlay.classList.remove("closing");
        overlay.classList.add("hidden");
        // Check if any other modal is still visible
        const anyOpen = document.querySelector(".modal-overlay:not(.hidden)");
        if (!anyOpen) {
            const wrapper = document.querySelector(".wrapper");
            if (wrapper) wrapper.classList.remove("blur-bg");
        }
        if (callback) callback();
    };

    if (card) {
        card.addEventListener("animationend", function handler() {
            card.removeEventListener("animationend", handler);
            finish();
        }, { once: true });
    } else {
        finish();
    }
}

/* ============================================
   CUSTOM CONFIRM / WARNING DIALOG
   ============================================ */
function showConfirmDialog({ title = "Peringatan", message = "Apakah Anda yakin?", okText = "Keluar", cancelText = "Batalkan", type = "danger", onOk }) {
    if (!confirmModal) return;
    document.getElementById("confirm-title").textContent = title;
    document.getElementById("confirm-text").textContent = message;

    const modalCard = confirmModal.querySelector(".modal-confirm");
    const iconWrap = confirmModal.querySelector(".confirm-icon-wrap");
    const okBtn = document.getElementById("confirm-ok-btn");
    const cancelBtn = document.getElementById("confirm-cancel-btn");

    if (modalCard) {
        modalCard.classList.remove("variant-success", "variant-danger");
        modalCard.classList.add(type === "success" ? "variant-success" : "variant-danger");
    }

    if (iconWrap) {
        if (type === "success") {
            iconWrap.innerHTML = `
                <svg class="confirm-icon" width="38" height="38" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="20 6 9 17 4 12"></polyline>
                </svg>
            `;
        } else {
            iconWrap.innerHTML = `
                <svg class="confirm-icon" width="38" height="38" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
                    <line x1="12" y1="9" x2="12" y2="13"></line>
                    <line x1="12" y1="17" x2="12.01" y2="17"></line>
                </svg>
            `;
        }
    }

    okBtn.textContent = okText;
    cancelBtn.textContent = cancelText;

    const cleanup = (cb) => {
        closeModal(confirmModal, () => {
            if (cb) cb();
        });
    };

    okBtn.onclick = () => {
        cleanup(async () => {
            if (onOk) await onOk();
        });
    };

    cancelBtn.onclick = () => {
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
        // Get reCAPTCHA v3 token
        const action = authMode === "login" ? "login" : "register";
        const captchaToken = await getRecaptchaToken(action);

        let result;
        if (authMode === "login") {
            result = await db.auth.signInWithPassword({ email, password, options: { captchaToken } });
        } else {
            result = await db.auth.signUp({ email, password, options: { captchaToken } });
        }

        console.log("Auth result:", result);

        if (result.error) {
            authError.textContent = translateAuthError(result.error.message);
            authError.classList.remove("hidden");
        } else if (authMode === "register" && result.data && result.data.user && !result.data.session) {
            authError.textContent = "Akun dibuat! Cek email untuk konfirmasi, atau matikan Confirm Email di Supabase Dashboard.";
            authError.classList.remove("hidden");
            authError.classList.add("info");
        }
        // onAuthStateChange handles login success
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
   CALENDAR
   ============================================ */
function getDaysInMonth(month, year) {
    return new Date(year, month + 1, 0).getDate();
}

function renderCalendar(direction = "fade") {
    daysGrid.innerHTML = "";
    monthLabel.textContent = MONTH_NAMES[currentMonth];

    const firstDayOfWeek = new Date(currentYear, currentMonth, 1).getDay();
    const totalDays      = getDaysInMonth(currentMonth, currentYear);
    const todayObj       = new Date();
    const isThisMonth    = todayObj.getMonth() === currentMonth && todayObj.getFullYear() === currentYear;
    const todayDate      = todayObj.getDate();
    const displayMonth   = currentMonth + 1;

    // For non-admin: only show approved. For admin: show both.
    const visibleApproved = approvedBirthdays;
    const visiblePending  = isAdmin ? pendingBirthdays : [];

    for (let i = 0; i < firstDayOfWeek; i++) {
        const empty = document.createElement("div");
        empty.className = "day-cell empty";
        daysGrid.appendChild(empty);
    }

    for (let d = 1; d <= totalDays; d++) {
        const cell = document.createElement("div");
        cell.className = "day-cell";

        const num = document.createElement("span");
        num.className = "day-number";
        num.textContent = d;
        if (isThisMonth && d === todayDate) num.classList.add("today");
        cell.appendChild(num);

        const aCount = visibleApproved.filter(b => b.day === d && b.month === displayMonth).length;
        const pCount = visiblePending.filter(b => b.day === d && b.month === displayMonth).length;

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

        const day = d;
        cell.addEventListener("click", () => handleDayClick(day, displayMonth));
        daysGrid.appendChild(cell);
    }

    // Smooth transition animation
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
    // Determine visible birthdays for this day
    const approved = approvedBirthdays.filter(b => b.day === day && b.month === month);
    const pending  = isAdmin ? pendingBirthdays.filter(b => b.day === day && b.month === month) : [];
    const all = [...approved, ...pending];

    if (all.length > 0) {
        openDetailModal(day, month, all);
    } else if (currentUser) {
        openAddModal(day, month);
    }
    // If not logged in and no birthdays, do nothing
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
   BIRTHDAY CRUD
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
        if (b) b.status = "approved";
        approvedBirthdays = allBirthdays.filter(x => x.status === "approved");
        pendingBirthdays  = allBirthdays.filter(x => x.status === "pending");
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
        // 1. Simpan ke tabel reject (jika tabel reject ada)
        try {
            await db.from("reject").insert([{
                name: b.name,
                day: b.day,
                month: b.month,
                user_id: b.user_id,
                user_email: b.user_email
            }]);
        } catch (e) {
            console.warn("Reject table insert warning:", e);
        }

        // 2. Hapus dari tabel birthdays
        const { error } = await db.from("birthdays").delete().eq("id", b.id);
        if (error) throw error;

        allBirthdays      = allBirthdays.filter(x => x.id !== b.id);
        approvedBirthdays = allBirthdays.filter(x => x.status === "approved");
        pendingBirthdays  = allBirthdays.filter(x => x.status === "pending");

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
   NOTIFICATION CENTER & TODAY'S BIRTHDAYS
   ============================================ */
let todayBirthdaysList = [];
let userStatusUpdates = [];

function getTodayBirthdays() {
    const t = new Date();
    const curDate = t.getDate();
    const curMonth = t.getMonth() + 1;
    return approvedBirthdays.filter(b => b.day === curDate && b.month === curMonth);
}

async function updateNotifBadge() {
    todayBirthdaysList = getTodayBirthdays();
    const todayCount = todayBirthdaysList.length;

    if (tabTodayBadge) {
        if (todayCount > 0) {
            tabTodayBadge.textContent = todayCount;
            tabTodayBadge.classList.remove("hidden");
        } else {
            tabTodayBadge.classList.add("hidden");
        }
    }

    let unreadStatusCount = 0;
    if (currentUser) {
        try {
            const [bRes, rRes] = await Promise.all([
                db.from("birthdays").select("*").eq("user_id", currentUser.id),
                db.from("reject").select("*").eq("user_id", currentUser.id)
            ]);
            const bData = (bRes && bRes.data) ? bRes.data : [];
            const rData = (rRes && rRes.data) ? rRes.data.map(x => ({ ...x, status: "rejected", isRejectTable: true })) : [];
            userStatusUpdates = [...bData, ...rData].sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));

            const lastSeenTime = parseInt(localStorage.getItem("last_seen_status_time_" + currentUser.id)) || 0;
            unreadStatusCount = userStatusUpdates.filter(item => {
                const itemTime = new Date(item.created_at || 0).getTime();
                return itemTime > lastSeenTime && (item.status === "approved" || item.status === "rejected");
            }).length;
        } catch (e) {
            console.error("Error updating status updates in badge:", e);
        }
    } else {
        userStatusUpdates = [];
    }

    if (tabStatusBadge) {
        if (unreadStatusCount > 0) {
            tabStatusBadge.textContent = unreadStatusCount;
            tabStatusBadge.classList.remove("hidden");
        } else {
            tabStatusBadge.classList.add("hidden");
        }
    }

    const totalBadge = todayCount + unreadStatusCount;
    if (notifBadge) {
        if (totalBadge > 0) {
            notifBadge.textContent = totalBadge;
            notifBadge.classList.remove("hidden");
        } else {
            notifBadge.classList.add("hidden");
        }
    }
}

function openNotifModal(forcedTab) {
    let targetTab = forcedTab;
    if (!targetTab) {
        // Jika ada status pengajuan baru/belum dilihat -> buka tab status
        const lastSeenTime = currentUser ? (parseInt(localStorage.getItem("last_seen_status_time_" + currentUser.id)) || 0) : 0;
        const hasNewStatus = userStatusUpdates.some(item => {
            const itemTime = new Date(item.created_at || 0).getTime();
            return itemTime > lastSeenTime && (item.status === "approved" || item.status === "rejected");
        });

        if (hasNewStatus) {
            targetTab = "status";
        } else if (todayBirthdaysList.length > 0) {
            targetTab = "today";
        } else {
            targetTab = "today";
        }
    }

    renderNotifPanes();
    switchNotifTab(targetTab);
    openModal(notifModal);

    // Tandai status telah dilihat jika membuka modal
    if (currentUser) {
        localStorage.setItem("last_seen_status_time_" + currentUser.id, Date.now());
        if (tabStatusBadge) tabStatusBadge.classList.add("hidden");
        if (notifBadge) {
            const todayCount = todayBirthdaysList.length;
            if (todayCount > 0) {
                notifBadge.textContent = todayCount;
                notifBadge.classList.remove("hidden");
            } else {
                notifBadge.classList.add("hidden");
            }
        }
    }
}

function closeNotifModal() {
    closeModal(notifModal);
}

function switchNotifTab(tabName) {
    if (tabName === "today") {
        tabBtnToday.classList.add("active");
        tabBtnStatus.classList.remove("active");
        notifPaneToday.classList.add("active");
        notifPaneToday.classList.remove("hidden");
        notifPaneStatus.classList.remove("active");
        notifPaneStatus.classList.add("hidden");
    } else {
        tabBtnStatus.classList.add("active");
        tabBtnToday.classList.remove("active");
        notifPaneStatus.classList.add("active");
        notifPaneStatus.classList.remove("hidden");
        notifPaneToday.classList.remove("active");
        notifPaneToday.classList.add("hidden");
    }
}

function renderNotifPanes() {
    renderNotifTodayPane();
    renderNotifStatusPane();
}

function renderNotifTodayPane() {
    if (!notifTodayList) return;
    notifTodayList.innerHTML = "";
    todayBirthdaysList = getTodayBirthdays();

    if (todayBirthdaysList.length === 0) {
        notifTodayList.innerHTML = '<div class="detail-empty">Tidak ada yang berulang tahun hari ini.</div>';
        return;
    }

    todayBirthdaysList.forEach(b => {
        const card = document.createElement("div");
        card.className = "today-bday-card";
        card.innerHTML = `
            <div class="today-bday-icon">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                    <line x1="16" y1="2" x2="16" y2="6"></line>
                    <line x1="8" y1="2" x2="8" y2="6"></line>
                    <line x1="3" y1="10" x2="21" y2="10"></line>
                </svg>
            </div>
            <div class="today-bday-info">
                <span class="today-bday-name">${b.name}</span>
                <span class="today-bday-sub">Sedang berulang tahun hari ini!</span>
            </div>
        `;
        notifTodayList.appendChild(card);
    });
}

function renderNotifStatusPane() {
    if (!notifStatusList) return;
    notifStatusList.innerHTML = "";

    if (!currentUser) {
        notifStatusList.innerHTML = '<div class="detail-empty">Silakan masuk akun untuk melihat status pengajuan Anda.</div>';
        return;
    }

    if (userStatusUpdates.length === 0) {
        notifStatusList.innerHTML = '<div class="detail-empty">Belum ada riwayat pengajuan.</div>';
        return;
    }

    userStatusUpdates.forEach(item => {
        const card = document.createElement("div");
        card.className = "notif-status-card";

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

        const dateStr = item.created_at ? new Date(item.created_at).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" }) : "";

        card.innerHTML = `
            <div class="notif-status-top">
                <span class="notif-status-name">${item.name}</span>
                <span class="status-pill ${pillClass}">
                    <span class="status-pill-dot"></span>${statusText}
                </span>
            </div>
            <div class="notif-status-desc">${descText}</div>
            <div class="notif-status-time">Tanggal Lahir: ${item.day} ${MONTH_NAMES[item.month - 1]}${dateStr ? ' • ' + dateStr : ''}</div>
        `;
        notifStatusList.appendChild(card);
    });
}

/* ============================================
   ADD MODAL
   ============================================ */
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
function closeAddModal() { closeModal(addModal); }

/* ============================================
   DETAIL MODAL
   ============================================ */
function openDetailModal(day, month, items) {
    detailTitle.textContent = day + " " + MONTH_NAMES[month - 1];
    detailList.innerHTML = "";

    if (!items || items.length === 0) {
        const empty = document.createElement("div");
        empty.className = "detail-empty";
        empty.textContent = "Tidak ada ulang tahun.";
        detailList.appendChild(empty);
    } else {
        items.forEach(b => {
            const item = document.createElement("div");
            item.className = "detail-item";

            const nameWrap = document.createElement("div");
            nameWrap.className = "detail-name-wrap";

            const nameEl = document.createElement("span");
            nameEl.className = "detail-name";
            nameEl.textContent = b.name;
            nameWrap.appendChild(nameEl);

            // Status badge (admin only)
            if (isAdmin) {
                const badge = document.createElement("span");
                badge.className = "status-badge " + (b.status === "approved" ? "approved" : "pending-status");
                badge.textContent = b.status === "approved" ? "OK" : "Pending";
                nameWrap.appendChild(badge);
            }

            item.appendChild(nameWrap);

            // Delete: owner or admin only
            if (currentUser && (b.user_id === currentUser.id || isAdmin)) {
                const delBtn = document.createElement("button");
                delBtn.className = "delete-btn";
                delBtn.textContent = "Hapus";
                delBtn.addEventListener("click", () => {
                    showConfirmDialog({
                        title: "Hapus Ulang Tahun",
                        message: `Hapus ulang tahun ${b.name}?`,
                        okText: "Hapus",
                        cancelText: "Batalkan",
                        onOk: async () => {
                            const ok = await deleteBirthday(b.id);
                            if (ok) {
                                item.remove();
                                if (detailList.querySelectorAll(".detail-item").length === 0) closeDetailModal();
                            }
                        }
                    });
                });
                item.appendChild(delBtn);
            }

            detailList.appendChild(item);
        });
    }

    // "Add more" — only if logged in
    if (currentUser) {
        const addMoreBtn = document.createElement("button");
        addMoreBtn.className = "add-more-btn";
        addMoreBtn.textContent = "+ Tambah lagi";
        addMoreBtn.addEventListener("click", () => { closeDetailModal(); openAddModal(day, month); });
        detailList.appendChild(addMoreBtn);
    }

    openModal(detailModal);
}
function closeDetailModal() { closeModal(detailModal); }

/* ============================================
   ADMIN PANEL
   ============================================ */
function openAdminModal() {
    adminList.innerHTML = "";
    if (pendingBirthdays.length === 0) {
        const empty = document.createElement("div");
        empty.className = "admin-empty";
        empty.textContent = "Tidak ada yang menunggu persetujuan.";
        adminList.appendChild(empty);
    } else {
        pendingBirthdays.forEach(b => {
            const item = document.createElement("div");
            item.className = "admin-item";

            const info = document.createElement("div");
            info.className = "admin-item-info";
            const top = document.createElement("div");
            top.className = "admin-item-top";
            const nameEl = document.createElement("span");
            nameEl.className = "admin-item-name";
            nameEl.textContent = b.name;
            top.appendChild(nameEl);
            const dateEl = document.createElement("span");
            dateEl.className = "admin-item-date";
            dateEl.textContent = b.day + " " + MONTH_NAMES[b.month - 1];
            top.appendChild(dateEl);
            info.appendChild(top);
            const emailEl = document.createElement("span");
            emailEl.className = "admin-item-email";
            emailEl.textContent = "oleh: " + b.user_email;
            info.appendChild(emailEl);
            item.appendChild(info);

            const actions = document.createElement("div");
            actions.className = "admin-item-actions";

            const approveBtn = document.createElement("button");
            approveBtn.className = "approve-btn";
            approveBtn.title = "Setujui";
            approveBtn.innerHTML = ICON.check;
            approveBtn.addEventListener("click", () => {
                showConfirmDialog({
                    title: "Setujui Permintaan",
                    message: `Anda yakin ingin menambah ulang tahun "${b.name}" ke kalender?`,
                    okText: "Setujui",
                    cancelText: "Batalkan",
                    type: "success",
                    onOk: async () => {
                        const ok = await approveBirthday(b.id);
                        if (ok) {
                            item.remove();
                            if (adminList.querySelectorAll(".admin-item").length === 0) {
                                const e = document.createElement("div");
                                e.className = "admin-empty";
                                e.textContent = "Tidak ada yang menunggu persetujuan.";
                                adminList.appendChild(e);
                            }
                        }
                    }
                });
            });
            actions.appendChild(approveBtn);

            const rejectBtn = document.createElement("button");
            rejectBtn.className = "reject-btn";
            rejectBtn.title = "Tolak";
            rejectBtn.innerHTML = ICON.cross;
            rejectBtn.addEventListener("click", () => {
                showConfirmDialog({
                    title: "Tolak Permintaan",
                    message: `Tolak pengajuan ulang tahun "${b.name}"?`,
                    okText: "Tolak",
                    cancelText: "Batalkan",
                    type: "danger",
                    onOk: async () => {
                        const ok = await rejectBirthday(b);
                        if (ok) {
                            item.remove();
                            if (adminList.querySelectorAll(".admin-item").length === 0) {
                                const e = document.createElement("div");
                                e.className = "admin-empty";
                                e.textContent = "Tidak ada yang menunggu persetujuan.";
                                adminList.appendChild(e);
                            }
                        }
                    }
                });
            });
            actions.appendChild(rejectBtn);

            item.appendChild(actions);
            adminList.appendChild(item);
        });
    }
    openModal(adminModal);
}
function closeAdminModal() { closeModal(adminModal); }

/* ============================================
   MEMBER REQUEST HISTORY
   ============================================ */
async function openHistoryModal() {
    if (!currentUser) return;
    if (!historyList) return;
    historyList.innerHTML = `
        <div class="history-loading">
            <div class="history-spinner"></div>
            <span>Memuat riwayat...</span>
        </div>
    `;
    openModal(historyModal);

    try {
        const [bRes, rRes] = await Promise.all([
            db.from("birthdays").select("*").eq("user_id", currentUser.id),
            db.from("reject").select("*").eq("user_id", currentUser.id)
        ]);

        const bItems = (bRes && bRes.data) ? bRes.data : [];
        const rItems = (rRes && rRes.data) ? rRes.data.map(x => ({ ...x, status: "rejected", isRejectTable: true })) : [];
        const validItems = [...bItems, ...rItems].sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));

        historyList.innerHTML = "";
        if (validItems.length === 0) {
            const empty = document.createElement("div");
            empty.className = "detail-empty";
            empty.textContent = "Belum ada pengajuan ulang tahun.";
            historyList.appendChild(empty);
            updateUserPendingBadge();
            return;
        }

        validItems.forEach(b => {
            const card = document.createElement("div");
            card.className = "history-card";

            const topRow = document.createElement("div");
            topRow.className = "history-card-top";

            const nameEl = document.createElement("span");
            nameEl.className = "history-name";
            nameEl.textContent = b.name;
            topRow.appendChild(nameEl);

            let pillClass = "pending-status";
            let pillText = "Menunggu";
            if (b.status === "approved") {
                pillClass = "approved";
                pillText = "Disetujui";
            } else if (b.status === "rejected") {
                pillClass = "rejected";
                pillText = "Ditolak";
            }

            const pill = document.createElement("span");
            pill.className = `status-pill ${pillClass}`;
            pill.innerHTML = `<span class="status-pill-dot"></span>${pillText}`;
            topRow.appendChild(pill);
            card.appendChild(topRow);

            const bottomRow = document.createElement("div");
            bottomRow.className = "history-card-bottom";

            const meta = document.createElement("div");
            meta.className = "history-meta";

            const bdayEl = document.createElement("span");
            bdayEl.className = "history-bday";
            bdayEl.innerHTML = `
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-1px; margin-right:5px; flex-shrink:0;">
                    <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                    <line x1="16" y1="2" x2="16" y2="6"></line>
                    <line x1="8" y1="2" x2="8" y2="6"></line>
                    <line x1="3" y1="10" x2="21" y2="10"></line>
                </svg>
                ${b.day} ${MONTH_NAMES[b.month - 1]}
            `;
            meta.appendChild(bdayEl);

            if (b.created_at) {
                const timeEl = document.createElement("span");
                timeEl.className = "history-time";
                const submittedDate = new Date(b.created_at).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });
                timeEl.textContent = `Diajukan: ${submittedDate}`;
                meta.appendChild(timeEl);
            }
            bottomRow.appendChild(meta);

            // Manual delete button
            const delBtn = document.createElement("button");
            delBtn.className = "history-del-btn";
            const isRejected = b.status === "rejected";
            delBtn.title = isRejected ? "Hapus Riwayat Penolakan" : "Hapus Ulang Tahun";
            delBtn.innerHTML = `
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18"></line>
                    <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
                Hapus
            `;
            delBtn.addEventListener("click", () => {
                showConfirmDialog({
                    title: isRejected ? "Hapus Riwayat Penolakan" : "Hapus Ulang Tahun",
                    message: isRejected
                        ? `Hapus riwayat pengajuan ditolak "${b.name}"?`
                        : `Hapus data ulang tahun "${b.name}"? Data ini juga akan terhapus dari kalender.`,
                    okText: "Hapus",
                    cancelText: "Batalkan",
                    type: "danger",
                    onOk: async () => {
                        let ok = false;
                        if (b.isRejectTable) {
                            try {
                                const { error } = await db.from("reject").delete().eq("id", b.id);
                                if (error) throw error;
                                ok = true;
                            } catch (e) {
                                console.error("Error deleting from reject table:", e);
                                alert("Gagal menghapus riwayat.");
                            }
                        } else {
                            ok = await deleteBirthday(b.id);
                        }

                        if (ok) {
                            card.remove();
                            if (historyList.querySelectorAll(".history-card").length === 0) {
                                const empty = document.createElement("div");
                                empty.className = "detail-empty";
                                empty.textContent = "Belum ada pengajuan ulang tahun.";
                                historyList.appendChild(empty);
                            }
                            updateUserPendingBadge();
                            updateNotifBadge();
                        }
                    }
                });
            });
            bottomRow.appendChild(delBtn);

            card.appendChild(bottomRow);
            historyList.appendChild(card);
        });

        updateUserPendingBadge();
    } catch (err) {
        console.error("History fetch error:", err);
        historyList.innerHTML = '<div class="detail-empty">Gagal memuat pengajuan.</div>';
    }
}

function closeHistoryModal() {
    closeModal(historyModal);
}

/* ============================================
   CUSTOM MONTH PICKER & DAY LIMITS
   ============================================ */
function getMaxDaysInMonth(month) {
    return getDaysInMonth(month - 1, 2024); // 2024 leap year allows Feb 29
}

function updateDayLimits() {
    const month = parseInt(inputMonth.value) || 1;
    const maxDays = getMaxDaysInMonth(month);
    inputDay.max = maxDays;
    inputDay.min = 1;

    let val = parseInt(inputDay.value);
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

function openMonthPicker() {
    renderMonthGrid();
    openModal(monthPickerModal);
}

function closeMonthPicker() {
    closeModal(monthPickerModal);
}

function renderMonthGrid() {
    if (!monthGrid) return;
    monthGrid.innerHTML = "";
    const currentSelected = parseInt(inputMonth.value) || 1;
    MONTH_NAMES.forEach((name, index) => {
        const m = index + 1;
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "month-grid-item" + (m === currentSelected ? " active" : "");
        const numStr = m < 10 ? "0" + m : "" + m;
        btn.innerHTML = `
            <span class="month-item-num">${numStr}</span>
            <span class="month-item-name">${name}</span>
        `;
        btn.addEventListener("click", () => {
            setSelectedMonth(m);
            closeMonthPicker();
        });
        monthGrid.appendChild(btn);
    });
}

/* ============================================
   EVENT LISTENERS
   ============================================ */
function setupListeners() {
    // Auth buttons on calendar
    document.getElementById("login-btn").addEventListener("click", () => openAuthModal("login"));
    document.getElementById("register-btn").addEventListener("click", () => openAuthModal("register"));
    document.getElementById("logout-btn").addEventListener("click", handleLogout);

    // Auth modal
    authForm.addEventListener("submit", handleAuth);
    document.querySelector(".auth-close-btn").addEventListener("click", closeAuthModal);
    authModal.addEventListener("click", e => { if (e.target === authModal) closeAuthModal(); });

    // Navigation
    document.getElementById("prev-btn").addEventListener("click", prevMonth);
    document.getElementById("next-btn").addEventListener("click", nextMonth);

    // Theme
    document.getElementById("theme-btn").addEventListener("click", toggleTheme);

    // Add
    addBtn.addEventListener("click", () => openAddModal());
    document.querySelector(".modal-close-btn").addEventListener("click", closeAddModal);
    addModal.addEventListener("click", e => { if (e.target === addModal) closeAddModal(); });

    // Custom Month Picker Trigger & Modal
    if (monthPickerBtn) monthPickerBtn.addEventListener("click", openMonthPicker);
    const monthPickerCloseBtn = document.querySelector(".month-picker-close-btn");
    if (monthPickerCloseBtn) monthPickerCloseBtn.addEventListener("click", closeMonthPicker);
    if (monthPickerModal) monthPickerModal.addEventListener("click", e => {
        if (e.target === monthPickerModal) closeMonthPicker();
    });

    // Number Day input clamping & bounds
    inputDay.addEventListener("input", () => {
        const month = parseInt(inputMonth.value) || 1;
        const maxDays = getMaxDaysInMonth(month);
        let val = parseInt(inputDay.value);
        if (val > maxDays) {
            inputDay.value = maxDays;
        }
    });
    inputDay.addEventListener("blur", () => {
        const month = parseInt(inputMonth.value) || 1;
        const maxDays = getMaxDaysInMonth(month);
        let val = parseInt(inputDay.value);
        if (!val || val < 1) {
            inputDay.value = 1;
        } else if (val > maxDays) {
            inputDay.value = maxDays;
        }
    });

    // Detail
    document.querySelector(".detail-close-btn").addEventListener("click", closeDetailModal);
    detailModal.addEventListener("click", e => { if (e.target === detailModal) closeDetailModal(); });

    // Admin
    adminBtn.addEventListener("click", openAdminModal);
    document.querySelector(".admin-modal-close-btn").addEventListener("click", closeAdminModal);
    adminModal.addEventListener("click", e => { if (e.target === adminModal) closeAdminModal(); });

    // History (Member Request History)
    if (historyBtn) historyBtn.addEventListener("click", openHistoryModal);
    const historyCloseBtn = document.querySelector(".history-close-btn");
    if (historyCloseBtn) historyCloseBtn.addEventListener("click", closeHistoryModal);
    if (historyModal) historyModal.addEventListener("click", e => { if (e.target === historyModal) closeHistoryModal(); });

    // Confirm modal outside click
    if (confirmModal) confirmModal.addEventListener("click", e => {
        if (e.target === confirmModal) document.getElementById("confirm-cancel-btn").click();
    });

    // Notification Center Modal
    if (notifBtn) notifBtn.addEventListener("click", () => openNotifModal());
    const notifCloseBtn = document.querySelector(".notif-close-btn");
    if (notifCloseBtn) notifCloseBtn.addEventListener("click", closeNotifModal);
    if (notifModal) notifModal.addEventListener("click", e => { if (e.target === notifModal) closeNotifModal(); });
    if (tabBtnToday) tabBtnToday.addEventListener("click", () => switchNotifTab("today"));
    if (tabBtnStatus) tabBtnStatus.addEventListener("click", () => switchNotifTab("status"));

    // Birthday form
    birthdayForm.addEventListener("submit", async e => {
        e.preventDefault();
        const name = inputName.value.trim();
        const day  = parseInt(inputDay.value);
        const month = parseInt(inputMonth.value);
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

    // Escape key closes any active popup
    document.addEventListener("keydown", e => {
        if (e.key === "Escape") {
            if (document.activeElement && document.activeElement.blur) {
                document.activeElement.blur();
            }
            if (confirmModal && !confirmModal.classList.contains("hidden")) {
                const cancelBtn = document.getElementById("confirm-cancel-btn");
                if (cancelBtn) cancelBtn.click();
            } else if (monthPickerModal && !monthPickerModal.classList.contains("hidden")) {
                closeMonthPicker();
            } else if (notifModal && !notifModal.classList.contains("hidden")) {
                closeNotifModal();
            } else if (historyModal && !historyModal.classList.contains("hidden")) {
                closeHistoryModal();
            } else if (detailModal && !detailModal.classList.contains("hidden")) {
                closeDetailModal();
            } else if (addModal && !addModal.classList.contains("hidden")) {
                closeAddModal();
            } else if (adminModal && !adminModal.classList.contains("hidden")) {
                closeAdminModal();
            } else if (authModal && !authModal.classList.contains("hidden")) {
                closeAuthModal();
            }
        }
    });
}

/* ============================================
   INIT
   ============================================ */
async function init() {
    initTheme();
    setSelectedMonth(now.getMonth() + 1);
    updateDayLimits();
    setupListeners();
    renderCalendar();

    // Auth state listener
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
            updateUIForAuth();
            await fetchBirthdays(); // Still fetch (anon sees approved only)
        }
    });
}

document.addEventListener("DOMContentLoaded", init);
