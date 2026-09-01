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

        if (isAdmin) {
            adminBadge.classList.remove("hidden");
            adminBtn.classList.remove("hidden");
            legendEl.classList.remove("hidden");
        } else {
            adminBadge.classList.add("hidden");
            adminBtn.classList.add("hidden");
            legendEl.classList.add("hidden");
        }
    } else {
        guestActions.classList.remove("hidden");
        userActions.classList.add("hidden");
        addBtn.classList.add("hidden");
        adminBtn.classList.add("hidden");
        adminBadge.classList.add("hidden");
        legendEl.classList.add("hidden");
    }
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
    authModal.classList.remove("hidden");
    setTimeout(() => authEmail.focus(), 100);
}

function closeAuthModal() {
    authModal.classList.add("hidden");
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
        let result;
        if (authMode === "login") {
            result = await db.auth.signInWithPassword({ email, password });
        } else {
            result = await db.auth.signUp({ email, password });
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

async function handleLogout() {
    await db.auth.signOut();
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

function renderCalendar() {
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
    renderCalendar();
}
function nextMonth() {
    currentMonth++;
    if (currentMonth > 11) { currentMonth = 0; currentYear++; }
    renderCalendar();
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
    checkTodayBirthdays();
    updateAdminBadge();
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
        return true;
    } catch (err) {
        console.error("Save error:", err);
        alert("Gagal menyimpan. Pastikan tabel & RLS sudah di-setup.");
        return false;
    }
}

async function deleteBirthday(id) {
    try {
        const { error } = await db.from("birthdays").delete().eq("id", id);
        if (error) throw error;
        allBirthdays      = allBirthdays.filter(b => b.id !== id);
        approvedBirthdays = allBirthdays.filter(b => b.status === "approved");
        pendingBirthdays  = allBirthdays.filter(b => b.status === "pending");
        renderCalendar();
        checkTodayBirthdays();
        updateAdminBadge();
        return true;
    } catch (err) {
        console.error("Delete error:", err);
        alert("Gagal menghapus.");
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
        checkTodayBirthdays();
        updateAdminBadge();
        return true;
    } catch (err) {
        console.error("Approve error:", err);
        alert("Gagal menyetujui.");
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

/* ============================================
   NOTIFICATION
   ============================================ */
function checkTodayBirthdays() {
    const t = new Date();
    const todayBdays = approvedBirthdays.filter(b => b.day === t.getDate() && b.month === t.getMonth() + 1);

    if (todayBdays.length > 0) {
        const names = todayBdays.map(b => b.name);
        let text;
        if (names.length === 1) text = "Selamat Ulang Tahun, " + names[0] + "!";
        else if (names.length === 2) text = "Selamat Ulang Tahun, " + names[0] + " & " + names[1] + "!";
        else {
            const last = names[names.length - 1];
            text = "Selamat Ulang Tahun, " + names.slice(0, -1).join(", ") + " & " + last + "!";
        }
        notificationText.textContent = text;
        notification.classList.remove("hidden");
    } else {
        notification.classList.add("hidden");
    }
}

/* ============================================
   ADD MODAL
   ============================================ */
function openAddModal(preDay, preMonth) {
    if (!currentUser) { openAuthModal("login"); return; }
    inputName.value = "";
    inputMonth.value = preMonth || (currentMonth + 1);
    updateDayOptions();
    if (preDay) inputDay.value = preDay;
    addModal.classList.remove("hidden");
    setTimeout(() => inputName.focus(), 100);
}
function closeAddModal() { addModal.classList.add("hidden"); }

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
                delBtn.addEventListener("click", async () => {
                    if (confirm("Hapus ulang tahun " + b.name + "?")) {
                        const ok = await deleteBirthday(b.id);
                        if (ok) {
                            item.remove();
                            if (detailList.querySelectorAll(".detail-item").length === 0) closeDetailModal();
                        }
                    }
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

    detailModal.classList.remove("hidden");
}
function closeDetailModal() { detailModal.classList.add("hidden"); }

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
            approveBtn.addEventListener("click", async () => {
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
            });
            actions.appendChild(approveBtn);

            const rejectBtn = document.createElement("button");
            rejectBtn.className = "reject-btn";
            rejectBtn.title = "Tolak";
            rejectBtn.innerHTML = ICON.cross;
            rejectBtn.addEventListener("click", async () => {
                if (confirm("Tolak ulang tahun " + b.name + "?")) {
                    const ok = await deleteBirthday(b.id);
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
            actions.appendChild(rejectBtn);

            item.appendChild(actions);
            adminList.appendChild(item);
        });
    }
    adminModal.classList.remove("hidden");
}
function closeAdminModal() { adminModal.classList.add("hidden"); }

/* ============================================
   FORM HELPERS
   ============================================ */
function populateMonthSelect() {
    inputMonth.innerHTML = "";
    MONTH_NAMES.forEach((name, i) => {
        const opt = document.createElement("option");
        opt.value = i + 1;
        opt.textContent = name;
        inputMonth.appendChild(opt);
    });
    inputMonth.value = currentMonth + 1;
}

function updateDayOptions() {
    const month = parseInt(inputMonth.value) - 1;
    const days  = getDaysInMonth(month, currentYear);
    const prev  = parseInt(inputDay.value) || 1;
    inputDay.innerHTML = "";
    for (let i = 1; i <= days; i++) {
        const opt = document.createElement("option");
        opt.value = i;
        opt.textContent = i;
        inputDay.appendChild(opt);
    }
    inputDay.value = prev <= days ? prev : days;
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

    // Detail
    document.querySelector(".detail-close-btn").addEventListener("click", closeDetailModal);
    detailModal.addEventListener("click", e => { if (e.target === detailModal) closeDetailModal(); });

    // Admin
    adminBtn.addEventListener("click", openAdminModal);
    document.querySelector(".admin-modal-close-btn").addEventListener("click", closeAdminModal);
    adminModal.addEventListener("click", e => { if (e.target === adminModal) closeAdminModal(); });

    // Notification close
    document.getElementById("close-notif").addEventListener("click", () => notification.classList.add("hidden"));

    // Month → Day
    inputMonth.addEventListener("change", updateDayOptions);

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
            alert("Berhasil! Menunggu persetujuan admin.");
        }
    });

    // Escape
    document.addEventListener("keydown", e => {
        if (e.key === "Escape") {
            if (!authModal.classList.contains("hidden")) closeAuthModal();
            if (!addModal.classList.contains("hidden")) closeAddModal();
            if (!detailModal.classList.contains("hidden")) closeDetailModal();
            if (!adminModal.classList.contains("hidden")) closeAdminModal();
        }
    });
}

/* ============================================
   INIT
   ============================================ */
async function init() {
    initTheme();
    populateMonthSelect();
    updateDayOptions();
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
