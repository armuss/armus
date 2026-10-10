/*
 * ARMUS - a printable payment receipt for a PAID withdrawal_requests row
 * (dashboard.html's Finansal tab, "Makbuzu Gör" button) - for a teacher's
 * own bookkeeping, not an official invoice (ARMUS has no automated
 * payout system - see withdrawal_requests' own schema.sql comment; the
 * actual bank transfer always happens manually, outside the app).
 *
 * Opens a plain, styled HTML page in a new window/tab and lets the
 * browser's own Print dialog ("Save as PDF" destination) produce the
 * actual PDF - no PDF-generation library, and Turkish characters
 * (ş/ğ/ı/İ/ö/ü/ç) render correctly for free since it's just real text,
 * not a hand-built PDF content stream with a limited base-font encoding.
 */

function armusEscapeHtmlForReceipt(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function armusOpenWithdrawalReceipt(withdrawal, teacher) {
  const lang = (typeof armusGetLang === "function" && armusGetLang() === "en") ? "en-US" : "tr-TR";
  const dateLabel = iso => iso ? new Date(iso).toLocaleDateString(lang) : "—";

  const receiptNo = withdrawal.id.replace(/-/g, "").slice(0, 10).toUpperCase();
  const rows = [
    [armusT("teacherDash.receiptNo", "Makbuz No"), receiptNo],
    [armusT("teacherDash.receiptTeacher", "Öğretmen"), `${armusEscapeHtmlForReceipt(teacher.name)} (${armusEscapeHtmlForReceipt(teacher.email)})`],
    [armusT("teacherDash.receiptRequestedAt", "Talep Tarihi"), dateLabel(withdrawal.requested_at)],
    [armusT("teacherDash.receiptPaidAt", "Ödeme Tarihi"), dateLabel(withdrawal.processed_at)],
    [armusT("teacherDash.receiptAmount", "Tutar"), `₺${withdrawal.amount}`],
    [armusT("teacherDash.receiptIban", "IBAN"), armusEscapeHtmlForReceipt(withdrawal.iban)],
    [armusT("teacherDash.receiptIbanName", "Hesap Sahibi"), armusEscapeHtmlForReceipt(withdrawal.iban_name)],
    [armusT("teacherDash.receiptStatus", "Durum"), armusT("teacherDash.withdrawStatusPaid", "Ödendi")],
  ];

  const html = `<!doctype html>
<html lang="tr">
<head>
<meta charset="utf-8">
<title>${armusT("teacherDash.receiptTitle", "ARMUS Ödeme Makbuzu")} - ${receiptNo}</title>
<style>
  body { font-family: Arial, sans-serif; background: #f4f4f2; margin: 0; padding: 32px; color: #1c1c1e; }
  .receipt { max-width: 480px; margin: 0 auto; background: #fff; border: 1px solid #ddd; border-radius: 12px; padding: 32px; }
  .brand { font-size: 22px; font-weight: 800; letter-spacing: -1px; color: #b8860b; margin-bottom: 4px; }
  .title { font-size: 15px; color: #555; margin-bottom: 24px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 24px; }
  td { padding: 8px 0; border-bottom: 1px solid #eee; font-size: 13.5px; }
  td:first-child { color: #777; width: 42%; }
  td:last-child { font-weight: 600; }
  .note { font-size: 11.5px; color: #999; line-height: 1.6; margin-bottom: 24px; }
  .print-btn { background: linear-gradient(90deg,#e8c777,#b8860b); color: #1c1c1e; border: none; font-weight: 700; font-size: 13px; padding: 10px 20px; border-radius: 10px; cursor: pointer; }
  @media print { .print-btn { display: none; } body { background: #fff; padding: 0; } .receipt { border: none; } }
</style>
</head>
<body>
  <div class="receipt">
    <div class="brand">ARMUS</div>
    <div class="title">${armusT("teacherDash.receiptTitle", "Ödeme Makbuzu")}</div>
    <table>
      ${rows.map(([label, value]) => `<tr><td>${label}</td><td>${value}</td></tr>`).join("")}
    </table>
    <p class="note">${armusT("teacherDash.receiptNote", "Bu makbuz sadece kendi muhasebe kayıtların için bilgilendirme amaçlıdır; resmi bir fatura değildir. ARMUS'ta otomatik bir ödeme sistemi yoktur - bu tutar ARMUS ekibi tarafından elden IBAN'ına gönderilmiştir.")}</p>
    <button class="print-btn" onclick="window.print()">${armusT("teacherDash.receiptPrint", "Yazdır / PDF Olarak Kaydet")}</button>
  </div>
</body>
</html>`;

  const receiptWindow = window.open("", "_blank");
  if (!receiptWindow) return false;
  receiptWindow.document.open();
  receiptWindow.document.write(html);
  receiptWindow.document.close();
  return true;
}
