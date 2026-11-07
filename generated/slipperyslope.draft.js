const SYNC_PC = 0x4dc;
const START_KEYS = [];
function createGame(rand) {
  const W = 64, H = 32;
  let pix = new Array(W*H).fill(0);
  function rb(a){ const o=a-0x200; return (o<0||o>=ROM_BYTES.length)?0:ROM_BYTES[o]; }
  function drawSprite(x,y,addr,h){
    for(let r=0;r<h;r++){ const b=rb(addr+r);
      for(let c=0;c<8;c++) if((b>>(7-c))&1){ const xx=(x+c)%W, yy=(y+r)%H; pix[yy*W+xx]^=1; } }
  }
  function clearScreen(){ pix.fill(0); }
  let maze = new Array(72);
  for(let i=0;i<72;i++) maze[i]=rb(0x209+i);
  let gtx=rb(0x251), gty=rb(0x252), ptx=rb(0x253), pty=rb(0x254);
  let vb=3, v3=3, va=0, v7=0, v6=0;
  let gx=gtx*5+2, gy=gty*5+1;
  let m202=rb(0x202), m203=rb(0x203), m204=rb(0x204), m205=rb(0x205);
  function drawBordersMaze(){
    drawSprite(0,1,0x327,15); drawSprite(62,1,0x327,15);
    drawSprite(0,16,0x327,15); drawSprite(62,16,0x327,15);
    for(let x=0;x<64;x+=8){ drawSprite(x,0,0x325,1); drawSprite(x,31,0x325,1); }
    drawSprite(2,1,0x326,1); drawSprite(61,1,0x326,1);
    drawSprite(2,30,0x326,1); drawSprite(61,30,0x326,1);
    for(let c=0;c<12;c++) for(let r=0;r<6;r++) drawSprite(2+c*5,1+r*5,0x34f+maze[c*6+r],5);
    gx=gtx*5+2; gy=gty*5+1; v7=0; vb=3; va=0;
    drawSprite(gx,gy,0x336,5);
    drawSprite(ptx*5+2,pty*5+1,0x2ed+vb*5,5);
  }
  function loadLevel(idx){
    const base=0x8ba+(idx-1)*0x4c;
    for(let i=0;i<72;i++) maze[i]=rb(base+i);
    gtx=rb(base+72); gty=rb(base+73); ptx=rb(base+74); pty=rb(base+75);
  }
  function ghostTick(){ drawSprite(gx,gy,0x33b+v7,5); v7+=5; if(v7===0x14) v7=0; }
  clearScreen();
  drawBordersMaze();
  const top=[[14,0x2dd],[19,0x2c5],[23,0x2c1],[26,0x2d5],[31,0x2d5],[36,0x2b5],[41,0x2d9],[46,0x2e9]];
  for(const t of top) drawSprite(t[0],4,t[1],4);
  const bot=[[20,0x2dd],[25,0x2c5],[29,0x2d1],[34,0x2d5],[39,0x2b5]];
  for(const t of bot) drawSprite(t[0],24,t[1],4);
  return {
    width: W, height: H,
    pixels(){ return pix.slice(); },
    state(){ return { ptx, pty, vb, v6 }; },
    step(keys){
      const held=function(k){ return (keys&(1<<k))!==0; };
      if(held(9)){ va=1; v3=0; }
      if(held(5)){ va=1; v3=1; }
      if(held(7)){ va=1; v3=2; }
      if(held(8)){ va=1; v3=3; }
      if(va!==1){ ghostTick(); return; }
      m205++; if(m205===0x64){ m205=0; m204++; } if(m204===0x64){ m204=0x63; m205=0x63; }
      const sx=ptx*5+2, sy=pty*5+1;
      drawSprite(sx,sy,0x2ed+vb*5,5);
      const t0=maze[ptx*6+pty];
      if(t0!==0x23) drawSprite(sx,sy,0x34f+t0,5);
      let guard=0;
      for(;;){
        vb=v3;
        const dxb=rb(0x315+vb*2), dyb=rb(0x315+vb*2+1);
        const dx=dxb>127?dxb-256:dxb, dy=dyb>127?dyb-256:dyb;
        const rx=(ptx+dx)&0xFF, ry=(pty+dy)&0xFF;
        const edge=(rx===0xFF||rx===0x0C||ry===0xFF||ry===0x06);
        if(!edge){ ptx=rx; pty=ry; } else { va=0; }
        if(!edge && (ptx*5+2)===gx && (pty*5+1)===gy) va=2;
        let v1=maze[ptx*6+pty];
        if(v1===0x05){ if(!edge){ ptx-=dx; pty-=dy; } va=0; v1=0x05; }
        if(v1===0x0a) va=3;
        if(v1===0x0f) vb=rb(0x31d+vb);
        if(v1===0x14) vb=rb(0x321+vb);
        if(v1===0x19){
          vb=rb(0x31d+vb);
          const ex=ptx*5+2, ey=pty*5+1;
          drawSprite(ex,ey,0x34f+v1,5);
          maze[ptx*6+pty]=0x1e;
          drawSprite(ex,ey,0x34f+0x1e,5);
          v1=0x19;
        } else if(v1===0x1e){
          vb=rb(0x321+vb);
          const ex=ptx*5+2, ey=pty*5+1;
          drawSprite(ex,ey,0x34f+v1,5);
          maze[ptx*6+pty]=0x19;
          drawSprite(ex,ey,0x34f+0x19,5);
          v1=0x1e;
        }
        if(v1===0x23){ }
        else { const ex=ptx*5+2, ey=pty*5+1; drawSprite(ex,ey,0x34f+v1,5); if(va===1) va=0; }
        if(va!==1){ const ex=ptx*5+2, ey=pty*5+1; drawSprite(ex,ey,0x2ed+vb*5,5); break; }
        const mx=ptx*5+2, my=pty*5+1;
        drawSprite(mx,my,0x301+vb*5,5);
        drawSprite(gx,gy,0x33b+v7,5);
        v7+=5; if(v7===0x14) v7=0;
        drawSprite(mx,my,0x301+vb*5,5);
        guard++;
        if(guard>90){ const ex=ptx*5+2, ey=pty*5+1; drawSprite(ex,ey,0x2ed+vb*5,5); va=0; break; }
      }
      if(va===0){ ghostTick(); return; }
      if(va===3){ if(v6!==0) loadLevel(v6); else { m204=m202; m205=m203; } clearScreen(); drawBordersMaze(); return; }
      rand(); rand(); rand();
      if(v6===0x0a) v6+=1; else v6=1;
      loadLevel(v6); clearScreen(); drawBordersMaze(); return;
    }
  };
}
