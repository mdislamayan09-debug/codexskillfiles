// ---- Cart state ----
const cart = [];
const $ = (s) => document.querySelector(s);
const cartItemsEl = $('#cartItems');
const cartCountEl = $('#cartCount');
const cartTotalEl = $('#cartTotal');

function render() {
  const count = cart.reduce((n, i) => n + i.qty, 0);
  const total = cart.reduce((s, i) => s + i.qty * i.price, 0);
  cartCountEl.textContent = count;
  cartTotalEl.textContent = '$' + total.toFixed(2);

  if (!cart.length) {
    cartItemsEl.innerHTML = '<p class="cart-empty">Your cart is empty — let the duels begin. 🧲</p>';
    return;
  }
  cartItemsEl.innerHTML = cart.map((i, idx) => `
    <div class="ci">
      <div>
        <div class="ci-name">${i.name}</div>
        <div class="ci-qty">Qty ${i.qty} · $${i.price.toFixed(2)} each</div>
        <button class="ci-rm" data-rm="${idx}">Remove</button>
      </div>
      <div class="ci-price">$${(i.qty * i.price).toFixed(2)}</div>
    </div>`).join('');
}

function addToCart(name, price) {
  const existing = cart.find((i) => i.name === name);
  if (existing) existing.qty++;
  else cart.push({ name, price: parseFloat(price), qty: 1 });
  render();
  openCart();
}

// ---- Cart drawer ----
const overlay = $('#cartOverlay');
const drawer = $('#cartDrawer');
function openCart() { overlay.classList.add('show'); drawer.classList.add('show'); drawer.setAttribute('aria-hidden', 'false'); }
function closeCart() { overlay.classList.remove('show'); drawer.classList.remove('show'); drawer.setAttribute('aria-hidden', 'true'); }

$('#openCart').addEventListener('click', openCart);
$('#closeCart').addEventListener('click', closeCart);
overlay.addEventListener('click', closeCart);

// Add-to-cart buttons (event delegation)
document.addEventListener('click', (e) => {
  const add = e.target.closest('[data-add]');
  if (add) { addToCart(add.dataset.add, add.dataset.price); return; }
  const rm = e.target.closest('[data-rm]');
  if (rm) { cart.splice(+rm.dataset.rm, 1); render(); }
});

$('#checkout').addEventListener('click', () => {
  if (!cart.length) return;
  // In a live Shopify store this routes to /cart/checkout.
  alert('🧲 Redirecting to secure checkout…\n\n(Demo) Connect this button to your Shopify checkout to go live.');
});

// ---- Sticky buy bar shows after hero scrolls away ----
const sticky = $('#stickyBuy');
const hero = document.querySelector('.hero');
new IntersectionObserver(([entry]) => {
  sticky.classList.toggle('show', !entry.isIntersecting);
}, { threshold: 0 }).observe(hero);

// ---- "Watching now" live counter jitter ----
const live = document.querySelector('.pill-live');
if (live) {
  let n = 217;
  setInterval(() => {
    n += Math.floor(Math.random() * 7) - 3;
    n = Math.max(180, Math.min(260, n));
    live.innerHTML = `<i></i> ${n} watching now`;
  }, 3200);
}

// ---- Board snap demo on click ----
const board = $('#board');
if (board) {
  board.addEventListener('click', () => {
    board.classList.add('snap');
    setTimeout(() => board.classList.remove('snap'), 900);
  });
}

render();
