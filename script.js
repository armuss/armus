document.querySelectorAll('[data-scroll]').forEach(btn=>{
  btn.addEventListener('click',()=>document.querySelector(btn.dataset.scroll)?.scrollIntoView({behavior:'smooth'}));
});
document.querySelectorAll('.filter').forEach(btn=>{
  btn.addEventListener('click',()=>{
    btn.classList.toggle('active');
  });
});
function armusRunHomeSearch(){
  const q=document.getElementById('search').value.trim();
  if(!q){
    document.getElementById('searchMessage').textContent='Arama alanına bir konu, seviye veya öğretmen adı yaz.';
    return;
  }
  window.location.href='teachers.html?q='+encodeURIComponent(q);
}
document.getElementById('searchBtn').addEventListener('click',armusRunHomeSearch);
document.getElementById('search').addEventListener('keydown',e=>{
  if(e.key==='Enter'){
    e.preventDefault();
    armusRunHomeSearch();
  }
});
