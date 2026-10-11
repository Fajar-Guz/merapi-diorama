# Generates the 57 s soundtrack for the scripted video (out/audio_raw.wav).
# Usage, from the repo root: pip install numpy scipy && python3 tools/audio.py
import numpy as np, wave
from scipy.signal import lfilter, butter, sosfilt
SR=48000; D=57.0; N=int(SR*D); t=np.arange(N)/SR
rng=np.random.default_rng(7)
L=np.zeros(N); R=np.zeros(N)
def bp(x,lo,hi,o=2): return sosfilt(butter(o,[lo/(SR/2),hi/(SR/2)],btype='band',output='sos'),x)
def lp(x,f,o=2): return sosfilt(butter(o,f/(SR/2),output='sos'),x)
def hp(x,f,o=2): return sosfilt(butter(o,f/(SR/2),btype='high',output='sos'),x)
def env(t0,t1,a=0.5,r=0.8):
    e=np.clip((t-t0)/max(a,1e-3),0,1)*np.clip((t1-t)/max(r,1e-3),0,1); return 0.5-0.5*np.cos(np.pi*e)
def add(sig,i0,gain=1.0,pan=0.5):
    i0=int(i0*SR); n=min(len(sig),N-i0)
    if n<=0: return
    L[i0:i0+n]+=sig[:n]*gain*np.sqrt(1-pan)*1.41*0.5*2; R[i0:i0+n]+=sig[:n]*gain*np.sqrt(pan)*1.41*0.5*2
def addc(sigL,sigR,g=1.0): 
    global L,R; L+=sigL*g; R+=sigR*g
noise=lambda n: rng.standard_normal(n)
# ---- room tone ----
rt=lp(noise(N),400)*0.012; addc(rt,lp(noise(N),400)*0.012)
# ---- day ambience: birds ----
day=np.clip(1-env(20.8,34.8,2.5,2.0),0,1)
def chirp(t0,f0,pan,g):
    n=int(SR*0.22); tt=np.arange(n)/SR; ph=0
    k=rng.integers(2,5); sig=np.zeros(n)
    for j in range(k):
        s0=int(j*0.055*SR); m=int(0.045*SR); ttt=np.arange(m)/SR; f=f0*(1+0.25*np.sin(2*np.pi*18*ttt))*(1.0+0.3*ttt/0.045)
        s=np.sin(2*np.pi*np.cumsum(f)/SR)*np.sin(np.pi*ttt/0.045)**2
        if s0+m<=n: sig[s0:s0+m]+=s
    add(sig,t0,g,pan)
tt0=0.5
while tt0<D-1:
    dd=tt0
    if dd<20.5 or 37.5<dd<52.5:
        g=0.035 if dd<20.5 else 0.02+0.02*min(1,max(0,(dd-46)/4))
        chirp(tt0,rng.uniform(2600,4200),rng.uniform(0.15,0.85),g)
    tt0+=rng.uniform(0.35,1.6)
# ---- night insects ----
ni=env(21.5,36.0,2.5,2.0)
cr=np.zeros(N)
for ts in np.arange(21.5,36,0.37):
    i0=int(ts*SR); n=int(SR*0.14); tt=np.arange(n)/SR
    s=np.sin(2*np.pi*4300*tt)*(0.5+0.5*np.sign(np.sin(2*np.pi*55*tt)))*np.sin(np.pi*tt/0.14)
    if i0+n<N: cr[i0:i0+n]+=s
addc(cr*0.012*ni,np.roll(cr,int(0.11*SR))*0.012*ni)
# ---- gamelan-ish motif (slendro-like) ----
sl=[0,240,480,720,960]  # cents
def note(c,base=293.66): return base*2**(c/1200)
def metal(t0,f,g,pan,dec=1.6):
    n=int(SR*4); tt=np.arange(n)/SR
    parts=[(1,1,dec),(2.01,0.35,dec*1.5),(2.76,0.22,dec*2),(4.1,0.08,dec*3),(1.003,0.6,dec)]
    s=sum(a*np.sin(2*np.pi*f*r*tt)*np.exp(-tt*d) for r,a,d in parts)*np.clip(tt/0.003,0,1)
    add(s,t0,g,pan)
mot=[(1.0,2),(1.6,3),(2.2,1),(3.4,0),(4.6,2),(5.2,4),(5.8,3),(7.0,2),(9.4,1),(10.0,2),(10.6,0),(12.4,3),(14.0,2),(14.6,4),(15.2,3),(16.4,1),(18.4,4),(18.6,2),(18.8,0),(19.8,3),(21.0,1)]
for ts,i in mot: metal(ts,note(sl[i]),0.05,0.35+0.06*i)
mot2=[(46.7,0),(46.9,2),(47.1,4),(48.2,3),(48.8,2),(49.4,1),(50.6,2),(51.2,3),(51.8,4),(53.0,2),(53.6,1),(54.2,0)]
for ts,i in mot2: metal(ts,note(sl[i]),0.05,0.4+0.05*i)
# low gong-ish drone pads
def gong(t0,f=73.4,g=0.22):
    n=int(SR*6); tt=np.arange(n)/SR
    s=(np.sin(2*np.pi*f*tt)+0.6*np.sin(2*np.pi*f*1.004*tt)+0.3*np.sin(2*np.pi*f*2.02*tt)*np.exp(-tt*0.8)+0.15*np.sin(2*np.pi*f*3.1*tt)*np.exp(-tt*1.5))*np.exp(-tt*0.55)*np.clip(tt/0.02,0,1)
    add(s,t0,g,0.5)
gong(0.2,73.4,0.16); gong(52.4,73.4,0.26)
# ---- UI clicks ----
def click(t0,g=0.12):
    n=int(SR*0.03); tt=np.arange(n)/SR; s=np.sin(2*np.pi*2200*tt)*np.exp(-tt*260)+0.5*hp(noise(n),3000)*np.exp(-tt*400); add(s,t0,g,0.55)
for c in [13.4,18.3,20.8,34.7,46.6]: click(c)
# grabs: soft fluffy whoosh
def fluff(t0,g=0.08):
    n=int(SR*0.5); tt=np.arange(n)/SR; s=bp(noise(n),300,1500)*np.sin(np.pi*tt/0.5)**2; add(s,t0,g,0.45)
for c in [6.95,37.6]: fluff(c)
# ---- rain ----
def rainbed(t0,t1,g):
    e=env(t0,t1,0.5,0.6); nl=hp(noise(N),900)*0.6+bp(noise(N),300,2500)*0.4; nr=hp(noise(N),900)*0.6+bp(noise(N),300,2500)*0.4
    drops=np.zeros(N); 
    for _ in range(int((t1-t0)*90)):
        i0=int(rng.uniform(t0,t1)*SR); n=int(SR*0.012); tt=np.arange(n)/SR
        if i0+n<N: drops[i0:i0+n]+=np.sin(2*np.pi*rng.uniform(2500,5000)*tt)*np.exp(-tt*500)*rng.uniform(0.3,1)
    addc((nl*0.05+drops*0.04)*e*g,(nr*0.05+np.roll(drops,331)*0.04)*e*g)
rainbed(9.1,12.6,1.0); rainbed(39.4,44.8,1.6)
# ---- wind brush ----
e=env(13.7,17.9,0.4,0.6); sw=0.6+0.4*np.sin(2*np.pi*0.9*(t-13.7))**2
wn=bp(noise(N),250,1400); wn2=bp(noise(N),250,1400)
addc(wn*0.07*e*sw,wn2*0.07*e*sw)
# ---- glass rattle while shaking ----
for k in range(int(3.0*4.2*2)):
    ts=24.4+k/(4.2*2)+rng.uniform(-0.01,0.01)
    n=int(SR*0.09); tt=np.arange(n)/SR; f=rng.uniform(2800,4600)
    s=(np.sin(2*np.pi*f*tt)+0.5*np.sin(2*np.pi*f*1.51*tt))*np.exp(-tt*55)+0.4*hp(noise(n),4000)*np.exp(-tt*120)
    add(s,ts,0.06,0.3+0.4*(k%2))
# ---- rumble & eruption roar ----
brown=lfilter([1],[1,-0.997],noise(N)); brown/=np.std(brown)
brown2=lfilter([1],[1,-0.997],noise(N)); brown2/=np.std(brown2)
rum=lp(brown,90,4); rum2=lp(brown2,90,4)
re=np.clip(env(24.4,44.0,2.5,9.0)*(0.5+0.5*env(26.0,36.0,1.2,6.0)),0,1)
mod=0.75+0.25*lp(noise(N),3)/np.std(lp(noise(N),3)+1e-9)*0.3
addc(rum*0.5*re*mod,rum2*0.5*re*mod)
roar=bp(brown,60,700); roar2=bp(brown2,60,700); roe=env(26.2,38.0,1.0,6.0)
addc(roar*0.18*roe,roar2*0.18*roe)
# explosion boom
def boom(t0,g):
    n=int(SR*3.5); tt=np.arange(n)/SR; s=lp(noise(n),160,4)*np.exp(-tt*1.3)*np.clip(tt/0.01,0,1); s/=np.max(np.abs(s))+1e-9
    s+=np.sin(2*np.pi*(45*np.exp(-tt*0.6))*tt)*np.exp(-tt*1.6)*0.7
    add(s,t0,g,0.5)
boom(26.3,0.55); boom(28.5,0.3)
# thunder
for ts in [27.8,28.7,29.6,30.2,31.1,32.5,33.3]:
    n=int(SR*3.0); tt=np.arange(n)/SR
    crack=hp(noise(n),1500)*np.exp(-tt*28)*1.2
    roll=lp(noise(n),300,3)*np.exp(-tt*1.1)*(0.6+0.4*np.sin(2*np.pi*3*tt)**2)*np.clip(tt/0.05,0,1)
    roll/=np.max(np.abs(roll))+1e-9
    add(crack*0.35+roll*0.4,ts,0.7,rng.uniform(0.3,0.7))
# kentongan alarm (bamboo slit drum): rapid wooden knocks
def knock(t0,g,pan):
    n=int(SR*0.12); tt=np.arange(n)/SR
    s=(np.sin(2*np.pi*720*tt)+0.6*np.sin(2*np.pi*1150*tt)+0.3*np.sin(2*np.pi*430*tt))*np.exp(-tt*45)+bp(noise(n),500,2500)*np.exp(-tt*200)*0.5
    add(s,t0,g,pan)
ts=26.0
while ts<33.6:
    k=min(1,(ts-26)/1.0)*min(1,(33.6-ts)/1.0)
    knock(ts,0.12*k,0.62); ts+=0.17+0.02*np.sin(ts*7)
# lahar mud flow
le=env(40.0,48.5,1.5,3.0); mf=lp(brown,220,3)*(0.7+0.3*np.sin(2*np.pi*0.7*t)); mf2=lp(brown2,220,3)
gur=bp(noise(N),120,500)*(0.5+0.5*np.sin(2*np.pi*5.3*t)**2)
addc((mf*0.32+gur*0.12)*le,(mf2*0.32+gur*0.12)*le)
# recovery shimmer
for j,c in enumerate([0,480,720,960,1200]): metal(46.65+j*0.09,note(c,587.3),0.03,0.3+0.1*j,dec=2.5)
# fades
fade=np.clip(t/0.6,0,1)*np.clip((D-t)/0.9,0,1)
L*=fade; R*=fade
mx=max(np.max(np.abs(L)),np.max(np.abs(R))); L/=mx*1.05; R/=mx*1.05
st=np.stack([L,R],1)
import os; os.makedirs('out', exist_ok=True)
with wave.open('out/audio_raw.wav','wb') as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes((st*32767).astype(np.int16).tobytes())
print('ok')
