require('dotenv').config();
const express = require('express');
const path = require('path');
const cors = require('cors');
const mongoose = require('mongoose');
const nodemailer = require('nodemailer'); // Robot Email

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ==========================================
// 1. KONEKSI KONEKSI MONGODB
// ==========================================
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log(`✅ BERHASIL TERSAMBUNG KE MONGODB CLOUD!`))
  .catch((err) => console.log(`❌ GAGAL TERSAMBUNG:`, err.message));

const dbSchema = new mongoose.Schema({
    data_id: { type: String, default: "CPNS_MAIN_DB" },
    users: Array,
    tokens: Array,
    bankSoal: Array
});
const MainDB = mongoose.model('MainDB', dbSchema);

// ==========================================
// 2. CONFIGURATION ROBOT EMAIL (NODEMAILER)
// ==========================================
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS // Menggunakan App Password Gmail
    }
});

// Fungsi pembantu untuk mengirim email
async function kirimEmailKePeserta(keEmail, subjek, isiTeks, isiHtml) {
    try {
        await transporter.sendMail({
            from: `"Portal CPNS 2026" <${process.env.EMAIL_USER}>`,
            to: keEmail,
            subject: subjek,
            text: isiTeks,
            html: isiHtml
        });
        console.log(`✉️ Email berhasil dikirim ke: ${keEmail}`);
    } catch (error) {
        console.log(`❌ Gagal mengirim email:`, error.message);
    }
}

// ==========================================
// 3. JALUR PIPA API SINKRONISASI DASAR
// ==========================================
app.get('/api/database', async (req, res) => {
    try {
        let dbData = await MainDB.findOne({ data_id: "CPNS_MAIN_DB" });
        if (!dbData) dbData = { users: [], tokens: [], bankSoal: [] };
        res.json(dbData);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/database', async (req, res) => {
    try {
        const { users, tokens, bankSoal } = req.body;
        await MainDB.findOneAndUpdate({ data_id: "CPNS_MAIN_DB" }, { users, tokens, bankSoal }, { upsert: true, new: true });
        res.json({ message: "Data tersinkronisasi!" });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ==========================================
// 4. API BARU: PROSES TOKEN & KIRIM EMAIL
// ==========================================
app.post('/api/pembayaran/simulasi', async (req, res) => {
    try {
        const { email } = req.body;
        const code = 'CPNS-' + Math.random().toString(36).substr(2, 6).toUpperCase();
        
        let dbData = await MainDB.findOne({ data_id: "CPNS_MAIN_DB" });
        if (!dbData) dbData = new MainDB({ users: [], tokens: [], bankSoal: [] });

        const newToken = { code, bankSoalId: null, status: 'unused', sessionData: null, usedBy: email, createdAt: new Date().toISOString() };
        dbData.tokens.push(newToken);
        await dbData.save();

        // Kirim Email Token Sungguhan
        const subjek = "🔑 KODE TOKEN TRYOUT CPNS 2026 ANDA";
        const teks = `Halo, Terima kasih telah melakukan pembayaran. Kode Token Anda adalah: ${code}. Gunakan token ini untuk membuka modul TryOut pilihan Anda.`;
        const html = `
            <div style="font-family: sans-serif; padding: 20px; max-width: 500px; border: 1px solid #e2e8f0; border-radius: 12px;">
                <h2 style="color: #2563eb; margin-bottom: 5px;">Portal CPNS 2026</h2>
                <p style="color: #64748b; font-size: 14px; margin-top: 0;">Konfirmasi Pembayaran Sukses</p>
                <hr style="border: 0; border-top: 1px solid #e2e8f0; margin: 20px 0;">
                <p>Halo,</p>
                <p>Pembayaran TryOut Anda sebesar <b>Rp 15.000</b> telah kami terima. Berikut adalah <b>Kode Token Universal</b> Anda:</p>
                <div style="background-color: #f1f5f9; padding: 15px; border-radius: 8px; text-align: center; margin: 25px 0;">
                    <span style="font-family: monospace; font-size: 24px; font-weight: bold; tracking-spacing: 2px; color: #0f172a;">${code}</span>
                </div>
                <p style="font-size: 13px; color: #64748b;">*1 Token hanya berlaku untuk 1 kali penyelesaian pada 1 Modul pilihan Anda.</p>
                <p style="margin-top: 30px;">Selamat berjuang,<br><b>Tim Aldy Raenaldy Control</b></p>
            </div>
        `;
        
        // Eksekusi kirim email di background
        await kirimEmailKePeserta(email, subjek, teks, html);

        // Kirim balik data database terbaru ke Frontend agar tersinkronisasi instan
        res.json({ message: "Token dikirim!", db: dbData, tokenBaru: code });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ==========================================
// 5. API BARU: LUPA PASSWORD & KIRIM EMAIL
// ==========================================
app.post('/api/auth/lupa-password', async (req, res) => {
    try {
        const { email } = req.body;
        let dbData = await MainDB.findOne({ data_id: "CPNS_MAIN_DB" });
        
        let userIndex = dbData.users.findIndex(u => u.email === email && u.role === 'peserta');
        if (userIndex === -1) return res.status(444).json({ error: "Email tidak ditemukan!" });

        const tempPass = Math.random().toString(36).substring(2, 8).toUpperCase();
        dbData.users[userIndex].password = tempPass;
        dbData.markModified('users'); // Beri tahu mongoose bahwa isi array dirubah
        await dbData.save();

        // Kirim Email Password Sementara
        const subjek = "🔒 PERMINTAAN KATA SANDI SEMENTARA";
        const teks = `Halo, Anda baru saja meminta reset kata sandi. Password sementara Anda adalah: ${tempPass}. Silakan masuk dan segera ubah password Anda di menu profil.`;
        const html = `
            <div style="font-family: sans-serif; padding: 20px; max-width: 500px; border: 1px solid #e2e8f0; border-radius: 12px;">
                <h2 style="color: #d97706; margin-bottom: 5px;">Portal CPNS 2026</h2>
                <p style="color: #64748b; font-size: 14px; margin-top: 0;">Reset Kata Sandi Akun</p>
                <hr style="border: 0; border-top: 1px solid #e2e8f0; margin: 20px 0;">
                <p>Halo,</p>
                <p>Kami menerima permintaan pemulihan akun Anda. Berikut adalah <b>Kata Sandi Sementara</b> Anda:</p>
                <div style="background-color: #fef3c7; padding: 15px; border-radius: 8px; text-align: center; margin: 25px 0;">
                    <span style="font-family: monospace; font-size: 20px; font-weight: bold; color: #92400e;">${tempPass}</span>
                </div>
                <p style="font-size: 13px; color: #64748b;">Demi keamanan, silakan masuk ke sistem menggunakan sandi di atas dan segera ubah di menu <b>Profil & Sandi</b>.</p>
                <p style="margin-top: 30px;">Salam,<br><b>Tim Admin Portal</b></p>
            </div>
        `;
        
        await kirimEmailKePeserta(email, subjek, teks, html);
        res.json({ message: "Sandi dikirim!", db: dbData });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Rute catch-all
app.use((req, res) => { res.sendFile(path.join(__dirname, 'public', 'index.html')); });
app.listen(PORT, () => { console.log(`🚀 SERVER MENYALA di http://localhost:${PORT}`); });