-- ============================================
-- SUPABASE SETUP (PostgreSQL)
-- Jalankan semua query ini di Supabase Dashboard → SQL Editor
-- ============================================

-- 1. Tabel Profiles (data user)
CREATE TABLE profiles (
    id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
    email TEXT NOT NULL,
    is_admin BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Read all profiles" ON profiles
    FOR SELECT TO authenticated USING (true);

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

CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();


-- 3. Tabel Birthdays (data ulang tahun)
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

-- User yg belum login bisa lihat yg approved saja
CREATE POLICY "Anon read approved" ON birthdays
    FOR SELECT TO anon USING (status = 'approved');

-- User yg login: lihat approved + pending milik sendiri + admin lihat semua
CREATE POLICY "Auth read" ON birthdays
    FOR SELECT TO authenticated USING (
        status = 'approved'
        OR user_id = auth.uid()
        OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true)
    );

-- User hanya bisa tambah atas nama sendiri
CREATE POLICY "Insert own" ON birthdays
    FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

-- User bisa hapus milik sendiri, admin bisa hapus semua
CREATE POLICY "Delete own or admin" ON birthdays
    FOR DELETE TO authenticated USING (
        user_id = auth.uid()
        OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true)
    );

-- Admin bisa update (approve/reject)
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

