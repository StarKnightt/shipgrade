// Hand-written HTML fixtures that mirror real pricing-page shapes.

export const SAAS_WITH_PAYPAL = `<!doctype html><html><head>
<title>Acme Notes: notes for engineering teams</title>
<meta name="description" content="Acme Notes is the shared notebook built for engineering teams who ship weekly.">
<script async src="https://www.paypal.com/web-sdk/v6/core"></script>
</head><body>
<h1>Notes your whole team actually reads</h1>
<section id="pricing">
  <h2>Simple, transparent pricing</h2>
  <p>Monthly or annually (save 20%). Cancel anytime. Secure checkout.</p>
  <div class="tier"><h3>Starter</h3><p>$9/mo</p>
    <ul><li>3 projects</li><li>Email support</li></ul>
    <button>Start Starter</button></div>
  <div class="tier"><h3>Pro</h3><p>$29 per month</p>
    <ul><li>Unlimited projects</li><li>Priority support</li></ul>
    <button>Get Pro</button></div>
  <div class="tier"><h3>Enterprise</h3><p>Custom pricing. Contact sales.</p>
    <a href="/contact">Contact sales</a></div>
  <p>30-day money-back guarantee. Pay with PayPal or card. Pay Later available.</p>
</section>
</body></html>`;

export const NO_PRICING = `<!doctype html><html><head><title>Foo</title></head><body>
<h1>The future of collaboration</h1>
<p>We empower teams to do more.</p>
<a href="/signup">Sign up</a>
</body></html>`;

export const LANDING_WITH_PRICING_LINK = `<!doctype html><html><head><title>Bar</title></head><body>
<nav><a href="/features">Features</a><a href="/pricing">Pricing</a><a href="https://other.com/pricing">Partner</a></nav>
<h1>Ship invoices in one click</h1>
</body></html>`;

export const FORCED_SIGNUP = `<!doctype html><html><head><title>Course</title></head><body>
<h1>Learn Rust in 30 days</h1>
<section class="pricing">
  <h2>Plans</h2>
  <div><h3>Basic</h3><p>$49 one-time</p><button>Sign up</button></div>
  <div><h3>Mentor</h3><p>$199 one-time</p><button>Sign up</button></div>
  <p>Create an account to purchase any course.</p>
</section>
</body></html>`;

export const STRIPE_MULTI_CURRENCY = `<!doctype html><html><head><title>Pix</title>
<script src="https://js.stripe.com/v3/"></script></head><body>
<h1>Photo edits in seconds</h1>
<h2>Pricing</h2>
<select><option>USD</option><option>EUR</option><option>GBP</option></select>
<div><h3>Hobby</h3><p>€12 / month</p><button>Subscribe</button></div>
<div><h3>Studio</h3><p>€39 / month</p><button>Subscribe</button></div>
</body></html>`;
