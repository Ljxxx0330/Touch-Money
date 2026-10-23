/**
 * js/vendor/gsap-boot.js —— 把内置的 GSAP 交给 ES Modules 用。
 *
 * index.html 里先用普通 <script> 加载 ./js/vendor/gsap.min.js（UMD 构建，它会挂到
 * window.gsap），本模块再把那个全局对象取出来给模块系统用。顺序是硬要求：
 * 普通脚本同步执行，type=module 的脚本延迟执行，所以模块脚本跑起来时 gsap 一定已经在。
 *
 * 为什么不用 `import gsap from 'gsap'`：本应用没有构建步骤，也不装 node_modules，
 * 浏览器解析不了裸模块名。内置一份 UMD 构建是最省事、且离线可用的做法。
 *
 * 这一层还顺手做了三件事：
 *   1. 设全局默认缓动（省得每处都写 ease）；
 *   2. 给 <html> 挂 gsap-on 类 —— CSS 靠它决定「动画归 GSAP 管还是走 CSS 兜底」。
 *      本来想用 @media (script) 表达「脚本在跑」，实测这台浏览器不认这条媒体特性
 *      （matchMedia('(script)').matches === false），媒体块里的规则根本不生效，
 *      CSS 兜底和 GSAP 就会抢同一批属性。类名由 JS 加，脚本没跑起来就没有这个类，
 *      语义正好，且不依赖浏览器是否支持某个新媒体特性。
 *   3. 提供 prefersReducedMotion()，让「系统要求减少动态效果」这条硬要求只有一处判断。
 */

const g = typeof window !== 'undefined' ? window.gsap : undefined;

if (g) {
  // 默认缓动与时长。注意**不设** paused:true —— paused 会让 gsap.set() 这类
  // 「本该立刻生效」的调用也推迟到 ticker 真正跑起来之后，而 set 的语义就是当场写上去。
  g.defaults({ ease: 'power2.out', duration: 0.4 });
  try {
    if (typeof document !== 'undefined' && document.documentElement) {
      document.documentElement.classList.add('gsap-on');
    }
  } catch {
    // 挂不上类只是让 CSS 兜底继续生效，不影响功能。
  }
}

/**
 * 系统是否要求减少动态效果。GSAP 的 matchMedia 与 CSS 媒体查询读同一个设置，
 * 所以动画与样式两边不会打架。
 * @returns {boolean}
 */
export function prefersReducedMotion() {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/** 内置的 GSAP；加载失败时是 undefined（调用方要能退化成「不做动画」）。 */
export const gsap = g;

/** GSAP 是否可用。不可用时所有动画退化为「直接跳到终态」。 */
export const hasGsap = Boolean(g);
