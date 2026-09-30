document.querySelectorAll('[data-scroll]').forEach(btn=>{
  btn.addEventListener('click',()=>document.querySelector(btn.dataset.scroll)?.scrollIntoView({behavior:'smooth'}));
});
document.querySelectorAll('.filter').forEach(btn=>{
  btn.addEventListener('click',()=>{
    btn.classList.toggle('active');
  });
});

// Scroll-triggered reveal: elements marked .reveal fade/slide in once
// they enter the viewport.
function armusInitScrollReveal(){
  const targets=document.querySelectorAll('.reveal');
  if(!targets.length)return;
  const reduceMotion=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if(reduceMotion||!('IntersectionObserver' in window)){
    targets.forEach(el=>el.classList.add('in-view'));
    return;
  }
  const observer=new IntersectionObserver(entries=>{
    entries.forEach(entry=>{
      if(entry.isIntersecting){
        entry.target.classList.add('in-view');
        observer.unobserve(entry.target);
      }
    });
  },{threshold:0.15,rootMargin:'0px 0px -60px 0px'});
  targets.forEach(el=>observer.observe(el));
}
armusInitScrollReveal();

// Hero teacher-stack carousel: 4 persistent card elements cycle through
// the roles left -> main -> right -> hidden(stage) -> left ... every 10s.
// The left and main cards physically slide into the next slot (no content
// swap, so the motion is a smooth transform/opacity glide, not a fade of
// text); the right card fades out as it leaves, and the hidden staging
// card - already holding the next teacher's info - fades in to take the
// left spot. Content is only ever rewritten on a card while it's fully
// hidden (opacity 0), so nothing flashes mid-slide.
function armusInitHeroRotator(){
  const stack=document.querySelector('.teacher-stack');
  if(!stack||typeof TEACHERS==='undefined'||!TEACHERS.length)return;
  const cardEls=Array.from(stack.querySelectorAll('.teacher-card'));
  if(cardEls.length<4)return;

  const reduceMotion=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if(reduceMotion)return;

  function fillCard(article,teacher){
    const portrait=article.querySelector('.portrait');
    portrait.className='portrait portrait-'+teacher.id;
    portrait.innerHTML=teacher.photo
      ? '<img src="'+teacher.photo+'" alt="">'
      : teacher.initials;
    article.querySelector('.rating').textContent='★ '+teacher.rating;
    article.querySelector('h3').textContent=teacher.name;
    article.querySelector('.role-label').textContent=teacher.role;
    article.querySelector('.tags').innerHTML=teacher.tags.slice(0,3).map(t=>'<span>'+t+'</span>').join('');
    article.querySelector('.price').innerHTML='₺'+teacher.price+' <small>/ ders</small>';
    article.querySelector('.card-body button').onclick=function(){
      window.location.href='teacher.html?teacher='+encodeURIComponent(teacher.id);
    };
  }

  const roles=['left','main','right','stage'];
  // roleOrder[k] = index into cardEls currently holding roles[k]; matches
  // the pos-left/pos-main/pos-right/pos-stage classes already in the HTML.
  let roleOrder=[0,1,2,3];
  let nextTeacherIndex=4%TEACHERS.length;

  function applyRoles(){
    roleOrder.forEach((elIndex,roleIdx)=>{
      cardEls[elIndex].className='teacher-card pos-'+roles[roleIdx];
    });
  }

  setInterval(()=>{
    const outgoingIndex=roleOrder[2]; // currently 'right', about to fade to 'stage'
    roleOrder=[roleOrder[3],roleOrder[0],roleOrder[1],roleOrder[2]];
    applyRoles();
    // wait for the fade-out to finish before swapping its content, so the
    // retiring card never visibly flashes new text while still in view
    setTimeout(()=>{
      fillCard(cardEls[outgoingIndex],TEACHERS[nextTeacherIndex%TEACHERS.length]);
      nextTeacherIndex++;
    },1050);
  },10000);
}
armusInitHeroRotator();

// Scroll-driven homepage intro: a single real lesson photo zooms in as
// the visitor scrolls through .scroll-intro-pin's tall runway, then
// crossfades into a mosaic of real ARMUS teacher photos (pulled from
// TEACHERS, teachers-data.js, so it never drifts out of sync with the
// actual demo roster) - "one lesson" becoming "hundreds of teachers".
// See the CSS comment above .scroll-intro-pin (index.html) for the
// pin/sticky mechanism itself. Every scroll-linked value here is set as
// a direct inline style, never a CSS transition, so it stays exactly
// locked to scroll position even on a fast flick or an instant jump.
function armusInitScrollIntro(){
  const pin=document.querySelector('.scroll-intro-pin');
  const singleImg=document.getElementById('introSingleImg');
  const layerSingle=document.getElementById('introLayerSingle');
  const layerMosaic=document.getElementById('introLayerMosaic');
  const mosaicGrid=document.getElementById('introMosaicGrid');
  const mist=document.getElementById('introMist');
  const burst=document.getElementById('introBurst');
  const videoCard=document.getElementById('introVideoCard');
  const copySingle=document.getElementById('introCopySingle');
  const copyMosaic=document.getElementById('introCopyMosaic');
  const nav=document.querySelector('header.nav');
  if(!pin||!singleImg||!layerSingle||!layerMosaic||!mosaicGrid||!mist||!burst||!videoCard||!copySingle||!copyMosaic)return;

  // display:none under prefers-reduced-motion (index.html CSS) makes this
  // pointless work either way, but skip the scroll listener too rather
  // than just leaving it be - no reason to pay for it.
  if(window.matchMedia('(prefers-reduced-motion: reduce)').matches)return;

  // appended, not innerHTML - mosaicGrid already holds the static .spark
  // decorative dots (index.html), and tiles need to paint after/above
  // them in DOM order for the scattered cluster's own z-index values to
  // make sense. Real tiles first (their CSS positions them by
  // nth-of-type(1..6) among the grid's div children), then 2 dimmed
  // "ghost" tiles appended last so they don't shift that numbering -
  // reusing 2 of the same photos is fine, they're barely visible
  // (blurred/dimmed, tucked behind), just a "more teachers behind these"
  // depth cue, not meant to be read individually.
  // Real tiles are now full teacher cards (photo, rating, favorite heart,
  // name, lesson/student counts, price, trial button) - matching
  // teachers.html's own .teacher-card markup, just under scoped
  // .scroll-intro-mosaic-grid .tile-* class names (index.html) instead of
  // its bare ones, since those are already spoken for elsewhere on this
  // page (the hero-band's .teacher-card rotator further down).
  const HEART_ICON='<svg viewBox="0 0 24 24" aria-hidden="true"><path stroke-linejoin="round" stroke-linecap="round" d="M12 20.6s-7.14-4.35-9.9-8.36C.5 9.7 1 6.6 3.5 5.1c2.13-1.28 4.68-.72 6.2 1.04L12 8.6l2.3-2.46c1.52-1.76 4.07-2.32 6.2-1.04 2.5 1.5 3 4.6 1.4 7.14C19.14 16.25 12 20.6 12 20.6z"/></svg>';
  if(typeof TEACHERS!=='undefined'&&TEACHERS.length){
    mosaicGrid.insertAdjacentHTML('beforeend',TEACHERS.slice(0,6).map(t=>
      '<div class="tile">'+
        '<div class="tile-photo"><img src="'+t.photo+'" alt="'+t.name+'" loading="lazy"></div>'+
        '<div class="tile-rating">★ '+t.rating+'</div>'+
        '<div class="tile-fav">'+HEART_ICON+'</div>'+
        '<div class="tile-body">'+
          '<p class="tile-name">'+t.name+'</p>'+
          '<div class="tile-tags"><span>'+t.completedLessons+' ders</span><span>'+t.students+' öğrenci</span></div>'+
          '<div class="tile-price">₺'+t.price+' <small>/ ders</small></div>'+
          '<div class="tile-trial">Deneme Dersi Al</div>'+
        '</div>'+
      '</div>'
    ).join(''));
    const ghosts=[TEACHERS[2],TEACHERS[4],TEACHERS[0],TEACHERS[5],TEACHERS[1]].filter(Boolean);
    mosaicGrid.insertAdjacentHTML('beforeend',ghosts.map((t,i)=>
      '<div class="tile ghost g'+(i+1)+'"><img src="'+t.photo+'" alt="" aria-hidden="true" loading="lazy"></div>'
    ).join(''));
  }

  // Ghost tiles fly out of the burst too now, same as the real cards -
  // they used to just sit at their resting spot for the whole sequence
  // (only the shared layer opacity faded them in), which read as
  // inconsistent once the real cards started visibly emerging from the
  // burst point.
  const emergeTiles=Array.from(mosaicGrid.querySelectorAll('.tile'));
  // Each card "flies out" of the burst and lands at its own hand-placed
  // spot (CSS, --emerge-x/-y/-s below) instead of just cross-fading into
  // place flat. tileEmergeOffsets[i] is the pixel vector from tile i's
  // own resting position back to the burst's origin point - measured
  // once (elements are already laid out by their CSS position/size at
  // this point, untouched by any scroll-driven transform yet) and re-
  // measured on resize, since it's fixed screen pixels, not something
  // percentages/vh can keep correct on their own across viewport
  // changes.
  let tileEmergeOffsets=[];
  function measureEmergeOffsets(){
    const originRect=burst.getBoundingClientRect();
    const originX=originRect.left,originY=originRect.top;
    tileEmergeOffsets=emergeTiles.map(tile=>{
      const r=tile.getBoundingClientRect();
      return{dx:originX-(r.left+r.width/2),dy:originY-(r.top+r.height/2)};
    });
  }
  measureEmergeOffsets();

  function smoothstep(edge0,edge1,x){
    const t=Math.min(1,Math.max(0,(x-edge0)/(edge1-edge0)));
    return t*t*(3-2*t);
  }

  let ticking=false;

  function update(){
    ticking=false;
    const rect=pin.getBoundingClientRect();
    const scrollable=rect.height-window.innerHeight;
    const progress=scrollable>0?Math.min(1,Math.max(0,-rect.top/scrollable)):0;

    // the classroom illustration itself barely moves now (a faint
    // ambient drift, not a real zoom) - the teacher's own video-call
    // photo is what the scroll actually zooms into, converging on her
    // face (transform-origin: 54% 24% in CSS matches roughly where her
    // face falls in avatars/hero-mobile-video-call.jpg) until it fills
    // most of the frame by the time the burst fires from that same spot.
    const zoomT=smoothstep(0,0.55,progress);
    singleImg.style.transform='scale('+(1+zoomT*0.12)+')';
    videoCard.style.transform='rotate(-3deg) scale('+(1+zoomT*5.5)+')';
    // the intro copy lives on the wide establishing shot - fades out
    // early and fast, before the video card (which now grows quickly)
    // gets big enough to visibly compete with it. The card itself needs
    // no fade of its own - it's the zoom's subject, so it just stays put
    // until .scroll-intro-single's own crossfade opacity (cross, below)
    // takes the whole layer down with it.
    copySingle.style.opacity=String(1-smoothstep(0.04,0.16,progress));

    // the floating nav (header.nav, every page) would otherwise sit on
    // top of this whole sequence throughout - fades out fast once
    // scrolling into the pin starts, and stays gone for the ENTIRE
    // mosaic section, not just the zoom/burst/settle part: progress
    // caps at 1 while the sticky stage still fills the whole viewport
    // (rect.bottom === innerHeight at that point), so waiting on
    // progress alone brought the nav back while the mosaic cards were
    // still the only thing on screen. Instead it tracks rect.bottom
    // directly through the extra scroll after unstick, and only
    // reveals in the last stretch as the pin's bottom edge - and with
    // it, the whole mosaic - actually leaves the top of the viewport.
    if(nav){
      const navHideOut=smoothstep(0,0.08,progress);
      const navRevealIn=smoothstep(window.innerHeight*0.2,0,rect.bottom);
      const navOpacity=Math.min(1,(1-navHideOut)+navRevealIn);
      nav.style.opacity=String(navOpacity);
      nav.style.pointerEvents=navOpacity<0.5?'none':'auto';
    }

    const cross=smoothstep(0.5,0.66,progress);
    layerSingle.style.opacity=String(1-cross);
    layerMosaic.style.opacity=String(cross);

    // a dust/mist + firework-burst window straddling the crossfade point
    // - the cluster visually erupts through it rather than just cross-
    // fading in flat. Mist now rises earlier and holds well past the
    // burst itself, all the way through the cards' own emerge travel
    // below, so there's a real dusty haze sitting behind them as they
    // fly out and land - not just a brief flash at the crossfade instant.
    const mistIn=smoothstep(0.42,0.54,progress);
    const mistOut=smoothstep(0.74,0.88,progress);
    const mistT=mistIn*(1-mistOut);
    mist.style.opacity=String(mistT*0.9);
    mist.style.transform='scale('+(0.85+mistT*0.4)+')';

    const burstIn=smoothstep(0.42,0.52,progress);
    const burstOut=smoothstep(0.64,0.78,progress);
    burst.style.setProperty('--t',String(burstIn*(1-burstOut)));
    burst.style.opacity=String(burstIn*(1-burstOut));

    // each card travels from the burst's origin point to its own resting
    // spot, growing from a small spark-sized speck up to full size as it
    // arrives - starts just as the burst itself fires and finishes
    // before the mist has fully cleared, so the cards read as flying out
    // of the explosion rather than fading in independently of it.
    const emergeT=smoothstep(0.46,0.76,progress);
    const emergeScale=0.12+emergeT*0.88;
    emergeTiles.forEach((tile,i)=>{
      const off=tileEmergeOffsets[i];
      if(!off)return;
      tile.style.setProperty('--emerge-x',(off.dx*(1-emergeT))+'px');
      tile.style.setProperty('--emerge-y',(off.dy*(1-emergeT))+'px');
      tile.style.setProperty('--emerge-s',String(emergeScale));
    });

    const settle=smoothstep(0.58,0.85,progress);
    mosaicGrid.style.transform='scale('+(1.06-settle*0.06)+')';
    copyMosaic.style.opacity=String(smoothstep(0.6,0.8,progress));
  }

  function onScroll(){
    if(ticking)return;
    ticking=true;
    requestAnimationFrame(update);
  }

  function onResize(){
    measureEmergeOffsets();
    onScroll();
  }

  update();
  window.addEventListener('scroll',onScroll,{passive:true});
  window.addEventListener('resize',onResize);
}
armusInitScrollIntro();

// Proof carousel: 3 stat/testimonial cards auto-cross-fade, with dots
// showing progress and doubling as manual controls.
function armusInitProofCarousel(){
  const photos=document.querySelectorAll('.proof-slide-photo');
  const facts=document.querySelectorAll('.proof-fact');
  const dots=document.querySelectorAll('.proof-dot');
  if(!photos.length)return;

  let index=0;

  function show(i){
    photos.forEach((p,n)=>p.classList.toggle('active',n===i));
    facts.forEach((f,n)=>f.classList.toggle('active',n===i));
    dots.forEach((d,n)=>d.classList.toggle('active',n===i));
    index=i;
  }

  dots.forEach((dot,n)=>dot.addEventListener('click',()=>show(n)));

  const reduceMotion=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if(!reduceMotion){
    setInterval(()=>show((index+1)%photos.length),5000);
  }
}
armusInitProofCarousel();
