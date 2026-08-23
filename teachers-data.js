/*
 * ARMUS - Shared teacher data
 * Used by teachers.html (marketplace grid) and teacher.html (profile page).
 * Later this will be replaced by real API/database calls; for now it's the
 * single source of truth so both pages never go out of sync.
 */

const TEACHERS = [
  {
    id: "sarah",
    initials: "SM",
    photo: "https://i.pravatar.cc/300?img=47",
    name: "Sarah M.",
    role: "IELTS & Speaking Uzmanı",
    price: 800,
    rating: 4.9,
    reviewCount: 127,
    tags: ["IELTS", "Konuşma", "İş İngilizcesi"],
    level: "İleri",
    availability: "Şu anda ders almaya uygun",
    about: [
      "Merhaba! Ben Sarah. İngilizce öğretmeniyim ve özellikle konuşma becerileri, IELTS ve profesyonel İngilizce üzerine çalışıyorum.",
      "Öğrencilerimin sadece gramer öğrenmesini değil, İngilizceyi gerçek hayatta rahatça kullanabilmesini hedefliyorum.",
      "Derslerimi öğrencinin seviyesine, hedeflerine ve öğrenme tarzına göre kişiselleştiriyorum."
    ],
    experience: "5+ Yıl deneyim",
    completedLessons: "1,240",
    students: 340,
    languages: "English / Türkçe",
    levelRange: "A2 – C2",
    specialties: ["IELTS", "Speaking", "Business English", "Interview English"],
    reviews: [
      { name: "Mehmet K.", stars: 5, text: "Sarah gerçekten çok iyi bir öğretmen. Konuşma konusunda kendime olan güvenim çok arttı." },
      { name: "Elif A.", stars: 5, text: "IELTS sınavına hazırlanırken çok yardımcı oldu. Dersler oldukça düzenli ve profesyonel." },
      { name: "Can D.", stars: 5, text: "İlk dersten itibaren seviyemi doğru analiz etti. Kesinlikle tavsiye ederim." }
    ]
  },
  {
    id: "david",
    initials: "DK",
    photo: "https://i.pravatar.cc/300?img=13",
    name: "David K.",
    role: "IELTS & YDS Uzmanı",
    price: 650,
    rating: 4.8,
    reviewCount: 96,
    tags: ["IELTS", "YDS", "Konuşma"],
    level: "İleri",
    availability: "Bu hafta 4 boş saat",
    about: [
      "Merhaba! Ben David. 8 yıldır İngilizce öğretmenliği yapıyorum ve özellikle IELTS ile YDS sınavlarına hazırlanan öğrencilere destek oluyorum.",
      "Sınav stratejileri, zaman yönetimi ve pratik konuşma çalışmalarıyla öğrencilerimin hedef puanlarına ulaşmasını sağlıyorum."
    ],
    experience: "8+ Yıl deneyim",
    completedLessons: "2,050",
    students: 480,
    languages: "English / Türkçe",
    levelRange: "B1 – C2",
    specialties: ["IELTS", "YDS", "Grammar", "Test Strategies"],
    reviews: [
      { name: "Burak S.", stars: 5, text: "YDS hazırlığımda David sayesinde hedeflediğim puanı aldım." },
      { name: "Zeynep T.", stars: 5, text: "Çok sistemli ve planlı ders anlatıyor." },
      { name: "Ahmet Y.", stars: 4, text: "IELTS Writing bölümünde büyük gelişme kaydettim." }
    ]
  },
  {
    id: "emily",
    initials: "EL",
    photo: "https://i.pravatar.cc/300?img=25",
    name: "Emily L.",
    role: "English Speaking Teacher",
    price: 500,
    rating: 4.9,
    reviewCount: 58,
    tags: ["Konuşma", "Başlangıç"],
    level: "Başlangıç",
    availability: "Şu anda ders almaya uygun",
    about: [
      "Merhaba, ben Emily! Yeni başlayan öğrencilerin İngilizceyle aralarındaki bariyeri kırmalarına yardımcı olmayı seviyorum.",
      "Derslerimde bol pratik, günlük konuşma kalıpları ve özgüven kazandırmaya odaklanıyorum."
    ],
    experience: "3+ Yıl deneyim",
    completedLessons: "610",
    students: 190,
    languages: "English",
    levelRange: "A1 – B1",
    specialties: ["Konuşma", "Telaffuz", "Günlük İngilizce", "Başlangıç Seviyesi"],
    reviews: [
      { name: "Selin K.", stars: 5, text: "Sıfırdan başladım, Emily ile konuşmaya cesaret ettim." },
      { name: "Onur B.", stars: 5, text: "Çok sabırlı ve pozitif bir öğretmen." },
      { name: "Merve C.", stars: 4, text: "Dersler eğlenceli geçiyor, hiç sıkılmıyorum." }
    ]
  },
  {
    id: "michael",
    initials: "MJ",
    photo: "https://i.pravatar.cc/300?img=52",
    name: "Michael J.",
    role: "TOEFL Uzmanı",
    price: 900,
    rating: 5.0,
    reviewCount: 214,
    tags: ["TOEFL", "Konuşma", "İleri"],
    level: "İleri",
    availability: "Bu hafta 2 boş saat",
    about: [
      "Merhaba, ben Michael. TOEFL sınavına hazırlanan öğrencilerle çalışıyorum.",
      "Reading, Listening, Speaking ve Writing bölümlerinin her biri için ayrı stratejiler geliştiriyor, öğrencilerimin akademik İngilizce becerilerini güçlendiriyorum."
    ],
    experience: "10+ Yıl deneyim",
    completedLessons: "3,400",
    students: 620,
    languages: "English",
    levelRange: "B2 – C2",
    specialties: ["TOEFL", "Academic Writing", "Listening", "Speaking"],
    reviews: [
      { name: "Deniz A.", stars: 5, text: "TOEFL puanımı 20 puan yükselttim, çok teşekkürler Michael." },
      { name: "Gizem R.", stars: 5, text: "Akademik yazma konusunda çok detaylı geri bildirim veriyor." },
      { name: "Kerem P.", stars: 5, text: "En iyi TOEFL öğretmeni, kesinlikle tavsiye ederim." }
    ]
  },
  {
    id: "anna",
    initials: "AP",
    photo: "https://i.pravatar.cc/300?img=44",
    name: "Anna P.",
    role: "Business English Coach",
    price: 550,
    rating: 4.7,
    reviewCount: 73,
    tags: ["İş İngilizcesi", "Konuşma", "Orta"],
    level: "Orta",
    availability: "Şu anda ders almaya uygun",
    about: [
      "Merhaba, ben Anna! İş dünyasında İngilizce kullanan profesyonellerle çalışıyorum.",
      "Toplantı İngilizcesi, e-posta yazımı, sunum becerileri ve mülakat hazırlığı konularında öğrencilerime destek oluyorum."
    ],
    experience: "6+ Yıl deneyim",
    completedLessons: "890",
    students: 260,
    languages: "English / Türkçe",
    levelRange: "B1 – C1",
    specialties: ["İş İngilizcesi", "Sunum Becerileri", "E-posta Yazımı", "Mülakat Hazırlığı"],
    reviews: [
      { name: "Ozan İ.", stars: 5, text: "İş görüşmesi öncesi Anna ile çalışmak büyük fark yarattı." },
      { name: "Pınar D.", stars: 4, text: "Toplantılarda artık çok daha rahat konuşabiliyorum." },
      { name: "Tuğçe M.", stars: 5, text: "Profesyonel ve işine hakim bir öğretmen." }
    ]
  },
  {
    id: "james",
    initials: "JW",
    photo: "https://i.pravatar.cc/300?img=33",
    name: "James W.",
    role: "Exam Preparation Teacher",
    price: 700,
    rating: 4.8,
    reviewCount: 102,
    tags: ["YDS", "TOEFL", "Orta"],
    level: "Orta",
    availability: "Bu hafta 5 boş saat",
    about: [
      "Merhaba, ben James. YDS ve TOEFL sınavlarına hazırlanan öğrencilere odaklanıyorum.",
      "Sınav formatına uygun bol pratik ve düzenli geri bildirimle öğrencilerimin hedeflerine ulaşmasını sağlıyorum."
    ],
    experience: "7+ Yıl deneyim",
    completedLessons: "1,580",
    students: 390,
    languages: "English / Türkçe",
    levelRange: "B1 – C1",
    specialties: ["YDS", "TOEFL", "Grammar", "Reading Comprehension"],
    reviews: [
      { name: "Ece N.", stars: 5, text: "YDS sınavına James ile çok iyi hazırlandım." },
      { name: "Kaan F.", stars: 4, text: "Gramer konularını çok net anlatıyor." },
      { name: "Aslı G.", stars: 5, text: "Düzenli ödevler ve geri bildirimler işe yaradı." }
    ]
  }
];
