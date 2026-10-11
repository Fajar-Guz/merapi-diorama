export const NOISE = /* glsl */`
float h21(vec2 p){ p = fract(p*vec2(123.34,456.21)); p += dot(p,p+45.32); return fract(p.x*p.y); }
float vn2(vec2 p){ vec2 i=floor(p), f=fract(p); vec2 u=f*f*(3.0-2.0*f);
  return mix(mix(h21(i),h21(i+vec2(1,0)),u.x), mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),u.x), u.y); }
float fbm2(vec2 p){ float s=0.0,a=0.5; for(int i=0;i<4;i++){ s+=a*vn2(p); p=p*2.03+vec2(17.3,-9.1); a*=0.5;} return s/0.9375; }
vec2 worley(vec2 p){ vec2 i=floor(p), f=fract(p); float d1=8.0,d2=8.0;
  for(int y=-1;y<=1;y++) for(int x=-1;x<=1;x++){ vec2 g=vec2(x,y); vec2 o=vec2(h21(i+g),h21(i+g+31.7)); vec2 r=g+o-f; float d=dot(r,r);
    if(d<d1){d2=d1;d1=d;} else if(d<d2){d2=d;} }
  return vec2(sqrt(d1),sqrt(d2)); }
`;
// box-local xz -> map uv
export const MAPUV = /* glsl */`vec2 mapUV(vec2 xz){ return vec2((xz.x+5.0)/10.0, (xz.y+3.5)/7.0); }`;
