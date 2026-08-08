document.querySelectorAll('[data-scroll]').forEach(btn=>{
  btn.addEventListener('click',()=>document.querySelector(btn.dataset.scroll)?.scrollIntoView({behavior:'smooth'}));
});
document.querySelectorAll('.filter').forEach(btn=>{
  btn.addEventListener('click',()=>{
    btn.classList.toggle('active');
  });
});
document.getElementById('searchBtn').addEventListener('click',()=>{
  const q=document.getElementById('search').value.trim();
  document.getElementById('searchMessage').textContent=q
    ? `"${q}" için öğretmen arama özelliği MVP'nin sonraki aşamasında bağlanacak.`
    : 'Arama alanına bir konu, seviye veya öğretmen adı yaz.';
});
