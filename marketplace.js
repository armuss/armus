/*
 * ARMUS - merges the fixed demo teachers (teachers-data.js) with real
 * registered teacher accounts (auth.js) into one bookable list, so a
 * teacher who signs up and fills in their dashboard profile actually
 * shows up in the marketplace instead of only existing in isolation.
 *
 * Requires teachers-data.js (TEACHERS) and auth.js (armusGetUsers) to
 * be loaded first.
 */

function armusTeacherFromUser(user) {

  const initials = user.name
    .split(" ")
    .map(part => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return {
    id: user.email,
    initials: initials || "?",
    name: user.name,
    role: user.title || "İngilizce Öğretmeni",
    price: user.price ?? 500,
    rating: null,
    reviewCount: 0,
    tags: ["Yeni Öğretmen"],
    level: "Tüm seviyeler",
    availability: user.availability || "Şu anda ders almaya uygun",
    about: user.bio
      ? [user.bio]
      : ["Bu öğretmen henüz bir tanıtım yazısı eklemedi."],
    experience: "Yeni",
    completedLessons: "0",
    languages: "English / Türkçe",
    levelRange: "A1 – C2",
    specialties: ["Genel İngilizce"],
    reviews: [],
  };
}

function armusGetMarketplaceTeachers() {

  const registeredTeachers = armusGetUsers()
    .filter(user => user.role === "teacher")
    .map(armusTeacherFromUser);

  return TEACHERS.concat(registeredTeachers);
}

function armusFindMarketplaceTeacher(id) {
  return armusGetMarketplaceTeachers().find(t => t.id === id) || null;
}
