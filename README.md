# ⚽ Prem Bahis — Sanal Premier Lig Tahmin Oyunu

Arkadaşlar arasında oynanan, **gerçek para içermeyen** sanal bir bahis/tahmin oyunu.
Nesine / Bilyoner / Maçkolik tarzında oran kartları, kullanıcı hesapları ve admin onayı vardır.

Altyapı: **Vercel** (uygulama) + **Supabase** (veritabanı) + **GitHub** (kod). Üçü de ücretsiz.

## Özellikler

- 👤 Kullanıcı adı + şifre ile kayıt / giriş
- ✅ Admin onayı olmadan kimse giriş yapamaz
- 💰 Her onaylanan kullanıcıya 1.000 TL sanal başlangıç bakiyesi
- 🏆 Premier Lig maçları, canlı oranlarla (The Odds API)
- 🎯 Bahis türleri: Maç Sonucu (1-X-2), Alt/Üst 2.5, Karşılıklı Gol
- 🧾 Tek maçlık kupon (tutar × oran = olası kazanç)
- 📜 Kişi kendi kupon geçmişini görür
- 👀 Kullanıcılar birbirlerinin bakiyesini ve kuponlarını görebilir (liderlik tablosu)
- ⚙️ Admin paneli: üye onaylama, maç/oran çekme, sonuç işleme, elle sonuçlandırma/iptal

---

## Kurulum (adım adım)

Sıra önemli: önce **Supabase**, sonra **GitHub**, en son **Vercel**.

### 1) Supabase — veritabanı

1. [supabase.com](https://supabase.com) → ücretsiz kayıt ol → **New project** oluştur.
   Bir veritabanı şifresi belirle (bir yere not al).
2. Proje açılınca sol menüden **SQL Editor** → **New query** → bu depodaki **`schema.sql`**
   dosyasının tamamını yapıştır → **Run**. (Tabloları oluşturur, bir kez yeterli.)
3. Bağlantı adresini al: **Project Settings → Database → Connection string → "Transaction pooler"**
   sekmesindeki URI'yi kopyala. Şuna benzer:
   `postgresql://postgres.xxxx:[YOUR-PASSWORD]@aws-0-...pooler.supabase.com:6543/postgres`
   `[YOUR-PASSWORD]` yerine 1. adımdaki şifreyi yaz. Bu tam adres **DATABASE_URL** olacak.

> Not: Mutlaka **Transaction pooler (port 6543)** adresini kullan — Vercel gibi serverless
> ortamlar için gereken budur.

### 2) The Odds API — canlı oranlar

- [the-odds-api.com](https://the-odds-api.com) → **Get API Key** → ücretsiz üye ol → verilen **API key**'i kopyala.
- (İstemezsen boş bırakabilirsin; o zaman örnek maçlarla açılır, maçları elle sonuçlandırırsın.)

### 3) GitHub — kod deposu

- Kodun bir GitHub deposunda olması gerekiyor (Vercel oradan deploy eder).
- Bunu senin adına ben yükleyebilirim (bir GitHub erişim anahtarı verirsen), ya da kendin yükleyebilirsin.

### 4) Vercel — yayına alma

1. [vercel.com](https://vercel.com) → GitHub ile ücretsiz kayıt ol.
2. **Add New → Project** → GitHub'daki **prem-bahis** deposunu seç → **Import**.
3. **Environment Variables** bölümüne şunları ekle:

   | Değişken | Değer |
   |---|---|
   | `DATABASE_URL` | Supabase Transaction pooler adresi (1. adım) |
   | `SESSION_SECRET` | uzun rastgele bir metin |
   | `ADMIN_USERNAME` | admin kullanıcı adın |
   | `ADMIN_PASSWORD` | admin şifren |
   | `START_BALANCE` | `1000` |
   | `ODDS_API_KEY` | The Odds API anahtarı (2. adım) |
   | `ODDS_REGION` | `eu` |
   | `CRON_SECRET` | (isteğe bağlı) rastgele metin — günlük otomatik güncelleme için |

4. **Deploy** de. Birkaç dakikada `https://prem-bahis-xxxx.vercel.app` gibi bir adres verir.
5. Linki arkadaşlarına gönder. Onlar kayıt olur, sen admin panelinden onaylarsın.

---

## Nasıl Oynanır

1. **Admin** girer, arkadaşları kayıt oldukça **Admin → Bekleyen Üyelikler**'den onaylar.
2. Herkes 1.000 TL ile başlar.
3. **Bülten**'den bir maça ve bir orana tıkla → tutarı gir → **Kuponu Onayla**.
4. Maç bitince: Admin panelinden **"Sonuçları Çek & Hesapla"** (canlı veri) ya da **elle skor gir**.
   Kazanan kuponların `tutar × oran` kadarı bakiyeye eklenir.
5. **Oyuncular** sekmesinden herkesin durumu, **Kuponlarım**'dan kendi geçmişin görülür.

Bahis türleri:
- **Maç Sonucu (1-X-2):** 1 = ev sahibi, X = beraberlik, 2 = deplasman kazanır
- **Alt/Üst 2.5:** toplam 3+ gol → Üst, 2 ve altı → Alt
- **Karşılıklı Gol:** iki takım da gol atarsa Var, atamazsa Yok

---

## Otomatik güncelleme (isteğe bağlı)

`vercel.json` içinde günlük bir **cron** tanımlı (`/api/cron/refresh`). Vercel'de `CRON_SECRET`
değişkenini ayarlarsan, her gün maçları ve sonuçları otomatik çeker. Ayarlamazsan sorun olmaz;
maçları admin panelindeki butonlarla elle çekersin.

---

## Yerelde çalıştırma (geliştirme)

```bash
npm install
cp .env.example .env     # DATABASE_URL (bir Postgres) ve diğerlerini doldur
# schema.sql'i veritabanında bir kez çalıştır
npm start                # http://localhost:3000
```

## Teknik

- **Uygulama:** Node.js + Express (Vercel serverless olarak `api/index.js`)
- **Veritabanı:** Supabase (Postgres), `postgres` (postgres.js) ile
- **Kimlik doğrulama:** imzalı çerez + bcrypt
- **Arayüz:** saf HTML/CSS/JS (`public/`)

```
api/index.js     → sunucu ve tüm API uçları (Vercel handler)
src/db.js        → Supabase/Postgres bağlantısı + ilk admin
src/oddsApi.js   → The Odds API entegrasyonu
src/settle.js    → kupon/sonuç hesaplama (transaction'lı)
src/seed.js      → örnek maçlar (API yoksa)
schema.sql       → Supabase tabloları (bir kez çalıştırılır)
vercel.json      → Vercel yönlendirme + cron
public/          → arayüz
```

> ⚠️ Bu bir eğlence uygulamasıdır. Gerçek para, ödeme veya çekim yoktur.
