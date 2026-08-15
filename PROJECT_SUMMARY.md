# ARMUS — Proje Özeti (Project Summary)

Bu belge, ARMUS projesinin başlangıcından bugüne kadar olan tüm sürecin
(fikir, iş modeli, tasarım kararları, yapılan işler ve şu anki durum)
tek bir yerde toplanmış özetidir.

---

## 1. Ana Fikir

**ARMUS**, Türkiye'de İngilizce öğrenmek isteyen Türk kullanıcılara yönelik
bir İngilizce eğitim platformudur.

İş modeli açısından Preply gibi marketplace'lere benzer, ancak ARMUS baştan
itibaren Türkiye pazarı için tasarlanır:

- Türkçe arayüz
- Türkiye'de ödeme
- Türkiye pazarına uygun öğretmenler
- Türk öğrencilerin ihtiyaçlarına özel içerik
- TL cinsinden fiyatlandırma
- Ders rezervasyon sistemi
- Deneme dersi (Trial Lesson) sistemi
- Puanlama sistemi
- Öğretmen profilleri
- Öğretmen arama ve filtreleme

Amaç sadece bir tanıtım sitesi değil, gerçek bir İngilizce eğitim
marketplace'i kurmaktır.

## 2. Konumlandırma (Positioning)

ARMUS'u sadece "Türkiye'nin Preply'si" olarak sunmak yerine:

> "ARMUS, Türk öğrenciler için İngilizce öğrenmeyi yeniden tasarlıyor."

Rekabet avantajı zamanla şunlardan oluşacak: iyi öğretmen sayısı, öğrenci
sayısı, güven, güvenli ödeme, yorumlar, planlama, kullanıcı deneyimi, veri
ve öğretmen-öğrenci ağı.

## 3. Pazar ve Rakipler

Türkiye'de Jaabi, Dersveral, turkceingilizce.com, Engoo Türkiye, British
Council English Online gibi servisler mevcut. Bu yüzden ARMUS "Türkiye'nin
ilk platformu" iddiasında bulunmamalı; bunun yerine öğretmenin kendi
fiyatını belirlediği, platform içi rezervasyon ve ödeme yapılan, başarılı
saatlere göre komisyonun azaldığı özel bir marketplace olarak konumlanmalı.

## 4. Komisyon Modeli

Öğretmen kendi ders ücretini belirler; ARMUS her dersten komisyon alır.
Başarılı ders saati arttıkça komisyon oranı düşer:

| Başarılı Ders Saati | ARMUS Komisyonu |
|---|---|
| 0–100 saat | %30 |
| 100–200 saat | %28 |
| 200–300 saat | %25 |
| 300–500 saat | %20 |
| 500+ saat | %15 |

Mantık: öğretmen platformda ne kadar başarılı olursa komisyon o kadar
azalır — bu öğretmenleri çekmek ve elde tutmak için kullanılır.

## 5. Ders Saati Hesabı

Ölçüt sadece rezervasyon sayısı değil, **gerçekleşen (başarılı) ders
saati**dir. Sadece fiilen yapılan dersler öğretmenin geçmişine sayılır.

## 6. Öğrenci Gelmezse (No-show)

Öğrenci rezerve edilen derse katılmazsa öğretmen yine de ücretini alır —
çünkü öğretmenin zamanı rezerve edilmiştir. No-show kurallarının detayları
ileride platform kurallarında netleştirilecek.

## 7. Deneme Dersi (Trial Lesson)

Preply modelinden farklı bir yaklaşım hedefleniyor: Trial, öğretmen için
güçlü bir pazarlama aracı olmalı.

- Öğrenci trial alır ve sonra kayıt olup kurs satın alırsa → trial ücreti
  öğretmene gider.
- Öğrenci trial alır ama hiçbir şey satın almazsa → trial ücreti ARMUS'ta
  kalır.

Amaç: öğretmeni trial vermeye teşvik etmek, ARMUS'un dönüşüm olmayan
trial'lardan gelir elde etmesini sağlamak ve sistemin kötüye
kullanılmasını zorlaştırmak.

## 8. Trial Kötüye Kullanım Riski

Öğretmen öğrencilerine "sadece trial al" diyerek tüm trial ücretini
kendine alabilir ve ARMUS'un geliri olmayabilir. Bu yüzden anti-abuse
önlemleri gerekir: öğrenci başına trial sınırı, öğretmen-öğrenci arasında
önceden ilişki tespiti, platform dışına çıkarma konusunda net kurallar,
dönüşüm oranı takibi, şüpheli trial sınırlaması, raporlama/inceleme
sistemi, rezervasyon ve ödeme aktivite kaydı.

## 9. Marka

- İsim: **ARMUS**
- Stil: samimi, profesyonel, minimal, modern
- Renkler: siyah, gri, gümüş, çok az beyaz
- Font: Inter
- Tasarım: minimal, yuvarlak köşeli kartlar, geniş boşluk, modern görünüm
- Logo fikri: sade, yazısız, siyah metalik zemin, gümüş/gri element,
  dairesel profil fotoğrafına uygun

## 10. Teknoloji (Başlangıç)

Programlama deneyimi sınırlı olduğu için en basit yoldan başlandı:
**HTML + CSS + JavaScript**

Ana dosyalar: `index.html`, `styles.css`, `script.js`. Bu, ilk prototip
için uygun; gerçek sürümde daha profesyonel bir mimariye geçilecek.

## 11. GitHub ve Vercel

- `armus` adında bir GitHub reposu oluşturuldu.
- GitHub, Vercel'e bağlandı; her commit otomatik deploy tetikler.
- İlk deployment biraz uzun sürdü ama loglarda "Build Completed" ve
  "Deployment completed" görüldü; site şu anda **Ready** durumunda ve
  gerçekten online.

## 12. Landing Page

Ana sayfa yayında. İçerik: ARMUS tanıtımı, navigasyon, Öğretmenler,
Nasıl Çalışır?, Hakkımızda.

## 13. Teacher Marketplace (`teachers.html`)

- **Arama:** isim, uzmanlık, konu bazlı
- **Filtreler:** Konuşma, IELTS, TOEFL, YDS, İş İngilizcesi; seviye:
  Başlangıç, Orta, İleri
- **Sıralama:** Önerilen, En düşük fiyat, En yüksek fiyat, En yüksek puan

### Örnek Öğretmenler

| Öğretmen | Uzmanlık | Fiyat | Puan |
|---|---|---|---|
| Sarah M. | IELTS & Speaking Uzmanı | ₺800/ders | 4.9 |
| David K. | IELTS & YDS Uzmanı | ₺650/ders | 4.8 |
| Emily L. | English Speaking Teacher | ₺500/ders | 4.9 |
| Michael J. | TOEFL Uzmanı | ₺900/ders | 5.0 |
| Anna P. | Business English Coach | ₺550/ders | 4.7 |
| James W. | Exam Preparation Teacher | ₺700/ders | 4.8 |

## 14. Öğretmen Profili (`teacher.html`)

Şu an Sarah M. için hazırlandı. İçerik: isim, avatar, doğrulama rozeti,
puan, uzmanlıklar, fiyat, uygunluk (availability), hakkında, deneyim,
tamamlanan ders sayısı, yorum sayısı, öğrenci yorumları, ders bilgisi,
diller, seviye, uzmanlık alanları, Trial Lesson butonu, ders rezervasyon
butonu.

`teachers.html` içinde Sarah M. kartı `teacher.html` sayfasına
bağlandı ve akış test edildi: **Sarah M. → Teacher Profile** başarıyla
çalışıyor.

## 15. Şu Anki Durum

Akış: **Landing Page → Öğretmenler → Sarah M. → Teacher Profile** ve bu
akış canlı sitede çalışıyor.

- [x] Landing Page
- [x] GitHub reposu
- [x] Vercel bağlantısı ve başarılı deployment
- [x] `teachers.html` (arama, filtre, sıralama, öğretmen kartları)
- [x] `teacher.html` (Sarah profili)
- [x] Sarah kartının profile bağlanması ve akışın test edilmesi

## 16. Önemli Mimari Karar: Dinamik Öğretmen Profilleri

Başlangıçta her öğretmen için ayrı bir HTML dosyası (`sarah.html`,
`david.html`, `emily.html`, ...) yapılması planlanmıştı. Bu fikirden
vazgeçildi çünkü 1.000 öğretmen için 1.000 dosya, mimariyi bozar.

**Yeni model:**

```
teacher.html?teacher=sarah
teacher.html?teacher=david
teacher.html?teacher=emily
```

Sayfa, öğretmen ID'sine göre doğru bilgiyi gösterecek. İleride bu bilgi
gerçek bir veritabanından okunacak. Bu, ARMUS'un basit bir demo'dan gerçek
bir marketplace mimarisine geçtiği aşamadır ve **bir sonraki geliştirme
adımıdır**.

## 17. Önerilen Geliştirme Yol Haritası

**Faz 1 — Frontend Prototip:** Landing Page, Teacher Marketplace, Arama,
Filtreler, Öğretmen Profili, Rezervasyon arayüzü.

**Faz 2 — Kimlik Doğrulama:** Öğrenci/Öğretmen kayıt ve giriş.

**Faz 3 — Öğretmen Sistemi:** Dashboard, profil düzenleme, fiyat
belirleme, uygunluk takvimi, ders saati takibi.

**Faz 4 — Rezervasyon:** Öğretmen seçimi, tarih/saat seçimi, rezervasyon
oluşturma, durum takibi.

**Faz 5 — Ödeme:** Türkiye ödeme altyapısı, öğrenci ödemesi, platform
komisyonu, öğretmen bakiyesi, para çekme sistemi.

**Faz 6 — Trial:** Trial rezervasyonu, trial ödemesi, dönüşüm takibi,
kurs satın alma, trial kötüye kullanım tespiti.

**Faz 7 — Yorumlar:** Öğrenci yorumu, puanlama, tamamlanan ders
doğrulaması.

**Faz 8 — Admin:** Admin paneli, öğretmen doğrulama, ödeme takibi,
anlaşmazlıklar, iadeler, raporlar, kötüye kullanım tespiti.

**Faz 9 — Gerçek Sınıf:** Video sınıf, sohbet, ekran paylaşımı, ders
notları, ödev, dosyalar.

## 18. Şimdilik Yapılmayacaklar

Ödeme altyapısı, veritabanı, giriş sistemi, görüntülü görüşme, mobil
uygulama, yapay zeka ve admin panelini aynı anda başlatmamak gerekiyor —
proje çok hızlı karmaşıklaşır. Önce kullanıcı akışı (user flow) doğru
kurulmalı.

**Öğrenci akışı:** Landing → Teachers → Search → Teacher Profile → Trial
→ Register → Payment → Booking → Lesson → Review

**Öğretmen akışı:** Register → Verification → Profile → Set Price →
Set Availability → Receive Booking → Teach → Get Paid → Commission
Level Up

## 19. Nihai Hedef

Amaç sadece güzel bir site değil; öğrenciyi doğru öğretmenle buluşturan,
her işlemden komisyon alan gerçek bir marketplace kurmaktır. Bir sonraki
adım, projeyi prototipten şu mimariye taşımaktır:

**Database + Authentication + Booking + Payment**

Sıradaki geliştirme adımı: **Dinamik Öğretmen Profilleri**
(`teacher.html?teacher=sarah` gibi query parametresi ile çalışan
profil sayfası).
