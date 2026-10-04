// Browser-side loader for the PayPal JS SDK v6 (sandbox).
// https://docs.paypal.ai/reference/sdk/js/v6/reference

export type PayPalComponent = "paypal-payments" | "paypal-subscriptions";

export interface PayPalSession {
  start(
    options: { presentationMode: "auto" | "popup" | "modal" | "redirect" },
    payment: Promise<{ orderId: string } | { subscriptionId: string }>,
  ): Promise<void>;
}

interface SessionCallbacks {
  onApprove: (data: { orderId?: string; subscriptionId?: string; payerId?: string }) => Promise<void> | void;
  onCancel?: (data?: unknown) => void;
  onError?: (error: { code?: string; message?: string }) => void;
}

export interface PayPalInstance {
  findEligibleMethods(options?: {
    currencyCode?: string;
    paymentFlow?: "ONE_TIME_PAYMENT" | "RECURRING_PAYMENT";
  }): Promise<{ isEligible(method: string): boolean }>;
  createPayPalOneTimePaymentSession(callbacks: SessionCallbacks): PayPalSession;
  // Some docs say createPayPalSubscriptionSession; the live sandbox SDK only has this name.
  createPayPalSubscriptionPaymentSession?(callbacks: SessionCallbacks): PayPalSession;
}

interface PayPalNamespace {
  createInstance(options: {
    clientId: string;
    components: PayPalComponent[];
    pageType?: string;
    locale?: string;
  }): Promise<PayPalInstance>;
}

declare global {
  interface Window {
    paypal?: PayPalNamespace;
  }
}

let scriptPromise: Promise<PayPalNamespace> | null = null;
const instances = new Map<string, Promise<PayPalInstance>>();

function loadScript(src: string): Promise<PayPalNamespace> {
  if (window.paypal?.createInstance) return Promise.resolve(window.paypal);
  if (!scriptPromise) {
    scriptPromise = new Promise((resolve, reject) => {
      const el = document.createElement("script");
      el.src = src;
      el.async = true;
      el.onload = () =>
        window.paypal?.createInstance ? resolve(window.paypal) : reject(new Error("PayPal SDK failed to initialise"));
      el.onerror = () => {
        scriptPromise = null;
        reject(new Error("Couldn't load the PayPal SDK"));
      };
      document.head.appendChild(el);
    });
  }
  return scriptPromise;
}

export function getPayPalInstance(
  sdkUrl: string,
  clientId: string,
  component: PayPalComponent,
): Promise<PayPalInstance> {
  const key = `${clientId}:${component}`;
  let inst = instances.get(key);
  if (!inst) {
    inst = loadScript(sdkUrl).then((paypal) =>
      paypal.createInstance({ clientId, components: [component], pageType: "checkout" }),
    );
    inst.catch(() => instances.delete(key));
    instances.set(key, inst);
  }
  return inst;
}

export function createSubscriptionSession(instance: PayPalInstance, callbacks: SessionCallbacks): PayPalSession {
  if (!instance.createPayPalSubscriptionPaymentSession) {
    throw new Error("This PayPal SDK build has no subscription session.");
  }
  return instance.createPayPalSubscriptionPaymentSession(callbacks);
}
