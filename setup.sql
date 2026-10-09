-- ============================================
-- SUPABASE SETUP (PostgreSQL)
-- Jalankan semua query ini di Supabase Dashboard → SQL Editor
-- ============================================

-- 1. Tabel Profiles (data user)
CREATE TABLE IF NOT EXISTS profiles (
    id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
    email TEXT NOT NULL,
    is_admin BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Read all profiles" ON profiles;
CREATE POLICY "Read all profiles" ON profiles
    FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Insert own profile" ON profiles;
CREATE POLICY "Insert own profile" ON profiles
    FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);


-- 2. Auto-create profile saat user daftar
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.profiles (id, email, is_admin)
    VALUES (NEW.id, NEW.email, false);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();


-- 3. Tabel Birthdays (Tabel Tunggal: pending, approved, rejected)
CREATE TABLE IF NOT EXISTS birthdays (
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

-- User yg belum login bisa lihat yg approved saja
DROP POLICY IF EXISTS "Anon read approved" ON birthdays;
CREATE POLICY "Anon read approved" ON birthdays
    FOR SELECT TO anon USING (status = 'approved');

-- User yg login: lihat approved + pengajuan milik sendiri (pending/approved/rejected) + admin lihat semua
DROP POLICY IF EXISTS "Auth read" ON birthdays;
CREATE POLICY "Auth read" ON birthdays
    FOR SELECT TO authenticated USING (
        status = 'approved'
        OR user_id = auth.uid()
        OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true)
    );

-- User hanya bisa tambah atas nama sendiri
DROP POLICY IF EXISTS "Insert own" ON birthdays;
CREATE POLICY "Insert own" ON birthdays
    FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

-- User bisa hapus milik sendiri, admin bisa hapus semua
DROP POLICY IF EXISTS "Delete own or admin" ON birthdays;
CREATE POLICY "Delete own or admin" ON birthdays
    FOR DELETE TO authenticated USING (
        user_id = auth.uid()
        OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true)
    );

-- Admin bisa update (approve / reject)
DROP POLICY IF EXISTS "Admin update" ON birthdays;
CREATE POLICY "Admin update" ON birthdays
    FOR UPDATE TO authenticated USING (
        EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true)
    ) WITH CHECK (
        EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true)
    );


-- ============================================
-- 4. Jadikan admin (jalankan SETELAH daftar akun)
-- Ganti email di bawah dengan email admin kamu
-- ============================================
-- UPDATE profiles SET is_admin = true WHERE email = 'email-admin-kamu@contoh.com';
