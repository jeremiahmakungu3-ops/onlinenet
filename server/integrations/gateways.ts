import crypto from 'crypto';
import type {
  DalipayProvider,
  HotspotPackage,
  PaymentGatewayCode,
  PaymentGatewayConfig,
  PaymentTransaction,
  Site,
  StoredGatewaySetting,
} from '../../packages/shared/types.ts';
import { store } from '../db/store.ts';

interface GatewaySpec {
  code: PaymentGatewayCode;
  name: string;
  providerLabel: string;
  channels: string[];
  webhookPath: string;
  apiUrlEnv: string;
  credentialEnvs: string[];
  webhookSecretEnv: string;
  collectionEndpointPath: string;
  referencePrefix: string;
}

export const GATEWAY_SPECS: GatewaySpec[] = [
  {
    code: 'dalipay',
    name: 'DaliPay Mobile Money',
    providerLabel: 'DaliPay M-Pesa',
    channels: ['Vodacom M-Pesa', 'Tigo Pesa', 'Airtel Money', 'Halopesa'],
    webhookPath: '/api/payments/webhooks/dalipay',
    apiUrlEnv: 'DALIPAY_API_URL',
    credentialEnvs: ['DALIPAY_API_URL', 'DALIPAY_API_KEY'],
    webhookSecretEnv: 'DALIPAY_WEBHOOK_SECRET',
    collectionEndpointPath: '/collections',
    referencePrefix: 'DLP-TZ',
  },
  {
    code: 'mpesa_tz',
    name: 'Vodacom M-Pesa OpenAPI',
    providerLabel: 'Vodacom M-Pesa',
    channels: ['Vodacom M-Pesa USSD Push', 'LIPA Paybill'],
    webhookPath: '/api/payments/webhooks/mpesa_tz',
    apiUrlEnv: 'MPESA_API_URL',
    credentialEnvs: ['MPESA_API_URL', 'MPESA_API_KEY'],
    webhookSecretEnv: 'MPESA_WEBHOOK_SECRET',
    collectionEndpointPath: '/ipg/v2/vodacomTZN/c2bPayment/singleStage/',
    referencePrefix: 'MPS-TZ',
  },
  {
    code: 'tigopesa_tz',
    name: 'Tigo Pesa (Mixx by Yas)',
    providerLabel: 'Tigo Pesa',
    channels: ['Tigo Pesa Direct Push', 'Merchant Till'],
    webhookPath: '/api/payments/webhooks/tigopesa_tz',
    apiUrlEnv: 'TIGOPESA_API_URL',
    credentialEnvs: ['TIGOPESA_API_URL', 'TIGOPESA_CLIENT_ID', 'TIGOPESA_CLIENT_SECRET'],
    webhookSecretEnv: 'TIGOPESA_WEBHOOK_SECRET',
    collectionEndpointPath: '/v1/tigo/payment-auth/authorize',
    referencePrefix: 'TIG-TZ',
  },
  {
    code: 'airtelmoney_tz',
    name: 'Airtel Money Tanzania',
    providerLabel: 'Airtel Money',
    channels: ['Airtel Money Push', 'Merchant Code'],
    webhookPath: '/api/payments/webhooks/airtelmoney_tz',
    apiUrlEnv: 'AIRTEL_API_URL',
    credentialEnvs: ['AIRTEL_API_URL', 'AIRTEL_CLIENT_ID', 'AIRTEL_CLIENT_SECRET'],
    webhookSecretEnv: 'AIRTEL_WEBHOOK_SECRET',
    collectionEndpointPath: '/merchant/v1/payments/',
    referencePrefix: 'AIR-TZ',
  },
  {
    code: 'selcom_tz',
    name: 'Selcom Pay Tanzania',
    providerLabel: 'Selcom Pay',
    channels: ['Mobile Money Aggregator', 'Visa / Mastercard', 'Tigo / M-Pesa / Airtel'],
    webhookPath: '/api/payments/webhooks/selcom_tz',
    apiUrlEnv: 'SELCOM_API_URL',
    credentialEnvs: ['SELCOM_API_URL', 'SELCOM_API_KEY', 'SELCOM_API_SECRET'],
    webhookSecretEnv: 'SELCOM_WEBHOOK_SECRET',
    collectionEndpointPath: '/v1/checkout/create-order-minimal',
    referencePrefix: 'SLC-TZ',
  },
  {
    code: 'azampay_tz',
    name: 'AzamPay Tanzania',
    providerLabel: 'AzamPay',
    channels: ['AzamPesa', 'M-Pesa', 'Tigo Pesa', 'Airtel Money', 'Halopesa'],
    webhookPath: '/api/payments/webhooks/azampay_tz',
    apiUrlEnv: 'AZAMPAY_API_URL',
    credentialEnvs: ['AZAMPAY_API_URL', 'AZAMPAY_CLIENT_ID', 'AZAMPAY_CLIENT_SECRET'],
    webhookSecretEnv: 'AZAMPAY_WEBHOOK_SECRET',
    collectionEndpointPath: '/azampay/mno/checkout',
    referencePrefix: 'AZM-TZ',
  },
];

export function isValidGatewayCode(code: string): code is PaymentGatewayCode {
  return GATEWAY_SPECS.some((g) => g.code === code);
}

function isEnvConfigured(envName: string): boolean {
  const val = process.env[envName];
  return Boolean(val && val.trim().length > 0);
}

function hydrateGateway(spec: GatewaySpec, organizationId: string, saved?: StoredGatewaySetting): PaymentGatewayConfig {
  const credentialsConfigured = spec.credentialEnvs.every(isEnvConfigured);
  const webhookSecretConfigured = isEnvConfigured(spec.webhookSecretEnv);

  return {
    id: saved?.id || `gw-${organizationId}-${spec.code}`,
    organizationId,
    code: spec.code,
    name: spec.name,
    providerLabel: spec.providerLabel,
    channels: spec.channels,
    enabled: saved?.enabled ?? false,
    merchantShortcode: saved?.merchantShortcode ?? '',
    accountName: saved?.accountName ?? '',
    webhookPath: spec.webhookPath,
    credentialsConfigured,
    webhookSecretConfigured,
    requiredEnvVars: [...spec.credentialEnvs, spec.webhookSecretEnv],
    updatedAt: saved?.updatedAt || new Date(0).toISOString(),
  };
}

export function getOrganizationGateways(organizationId: string): PaymentGatewayConfig[] {
  return GATEWAY_SPECS.map((spec) => {
    const saved = store.paymentGateways.find(
      (g) => g.organizationId === organizationId && g.code === spec.code
    );
    return hydrateGateway(spec, organizationId, saved);
  });
}

export function upsertOrganizationGateway(params: {
  organizationId: string;
  code: PaymentGatewayCode;
  enabled?: boolean;
  merchantShortcode?: string;
  accountName?: string;
}): PaymentGatewayConfig {
  const spec = GATEWAY_SPECS.find((g) => g.code === params.code);
  if (!spec) {
    throw new Error('Unsupported payment gateway code.');
  }

  let existing = store.paymentGateways.find(
    (g) => g.organizationId === params.organizationId && g.code === params.code
  );
  if (!existing) {
    existing = {
      id: `gw-${params.organizationId}-${params.code}`,
      organizationId: params.organizationId,
      code: params.code,
      enabled: false,
      merchantShortcode: '',
      accountName: '',
      updatedAt: new Date().toISOString(),
    };
    store.paymentGateways.push(existing);
  }

  if (typeof params.enabled === 'boolean') {
    existing.enabled = params.enabled;
  }
  if (typeof params.merchantShortcode === 'string') {
    existing.merchantShortcode = params.merchantShortcode.trim().slice(0, 40);
  }
  if (typeof params.accountName === 'string') {
    existing.accountName = params.accountName.trim().slice(0, 80);
  }
  existing.updatedAt = new Date().toISOString();
  store.save();

  return hydrateGateway(spec, params.organizationId, existing);
}

function buildGatewayAuthHeaders(spec: GatewaySpec): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (spec.code === 'dalipay') {
    headers.Authorization = `Bearer ${process.env.DALIPAY_API_KEY!.trim()}`;
  } else if (spec.code === 'mpesa_tz') {
    headers.Authorization = `Bearer ${process.env.MPESA_API_KEY!.trim()}`;
  } else if (spec.code === 'selcom_tz') {
    const apiKey = process.env.SELCOM_API_KEY!.trim();
    const apiSecret = process.env.SELCOM_API_SECRET!.trim();
    const timestamp = new Date().toISOString();
    const digest = crypto.createHmac('sha256', apiSecret).update(timestamp).digest('base64');
    headers.Authorization = `SELCOM ${Buffer.from(apiKey).toString('base64')}`;
    headers['Digest-Method'] = 'HS256';
    headers.Digest = digest;
    headers.Timestamp = timestamp;
  } else if (spec.code === 'tigopesa_tz') {
    const creds = Buffer.from(
      `${process.env.TIGOPESA_CLIENT_ID!.trim()}:${process.env.TIGOPESA_CLIENT_SECRET!.trim()}`
    ).toString('base64');
    headers.Authorization = `Basic ${creds}`;
  } else if (spec.code === 'airtelmoney_tz') {
    const creds = Buffer.from(
      `${process.env.AIRTEL_CLIENT_ID!.trim()}:${process.env.AIRTEL_CLIENT_SECRET!.trim()}`
    ).toString('base64');
    headers.Authorization = `Basic ${creds}`;
  } else if (spec.code === 'azampay_tz') {
    const creds = Buffer.from(
      `${process.env.AZAMPAY_CLIENT_ID!.trim()}:${process.env.AZAMPAY_CLIENT_SECRET!.trim()}`
    ).toString('base64');
    headers.Authorization = `Basic ${creds}`;
  }

  return headers;
}

export async function dispatchGatewayCollection(params: {
  gatewayCode: PaymentGatewayCode;
  site: Site;
  pkg: HotspotPackage;
  customerPhone: string;
  providerLabel?: DalipayProvider;
}): Promise<PaymentTransaction> {
  const spec = GATEWAY_SPECS.find((g) => g.code === params.gatewayCode);
  if (!spec) {
    throw new Error('Unsupported payment gateway.');
  }

  const orgGateways = getOrganizationGateways(params.site.organizationId);
  const gwConfig = orgGateways.find((g) => g.code === params.gatewayCode);
  if (!gwConfig || !gwConfig.enabled) {
    throw new Error(`${spec.name} is not enabled for ${params.site.name}. Enable it in Payment Gateways.`);
  }
  if (!gwConfig.credentialsConfigured) {
    throw new Error(
      `${spec.name} credentials (${spec.credentialEnvs.join(', ')}) are not configured on this server.`
    );
  }

  const baseUrl = process.env[spec.apiUrlEnv]!.trim();
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(baseUrl);
  } catch {
    throw new Error(`Configured ${spec.apiUrlEnv} is not a valid URL.`);
  }
  if (parsedUrl.protocol !== 'https:' && parsedUrl.protocol !== 'http:') {
    throw new Error(`Configured ${spec.apiUrlEnv} must use http or https.`);
  }

  const reference = `${spec.referencePrefix}${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${crypto.randomInt(1000, 9999)}`;
  const targetUrl = `${baseUrl.replace(/\/$/, '')}${spec.collectionEndpointPath}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  let response: Response;
  try {
    response = await fetch(targetUrl, {
      method: 'POST',
      headers: buildGatewayAuthHeaders(spec),
      signal: controller.signal,
      body: JSON.stringify({
        reference,
        amount: params.pkg.priceTzs,
        currency: 'TZS',
        phone: params.customerPhone.trim(),
        provider: params.providerLabel || spec.providerLabel,
        merchantShortcode: gwConfig.merchantShortcode || undefined,
        accountName: gwConfig.accountName || undefined,
        metadata: {
          gatewayCode: spec.code,
          siteId: params.site.id,
          packageId: params.pkg.id,
          organizationId: params.site.organizationId,
        },
      }),
    });
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(`${spec.name} collection error (${response.status}): ${errText || response.statusText}`);
  }

  const tx: PaymentTransaction = {
    id: `pay-${crypto.randomBytes(3).toString('hex')}`,
    reference,
    organizationId: params.site.organizationId,
    siteId: params.site.id,
    siteName: params.site.name,
    packageId: params.pkg.id,
    packageName: params.pkg.name,
    customerPhone: params.customerPhone.trim(),
    gatewayCode: spec.code,
    provider: params.providerLabel || (spec.providerLabel as DalipayProvider),
    amountTzs: params.pkg.priceTzs,
    status: 'Pending',
    createdAt: new Date().toISOString(),
  };

  store.payments.unshift(tx);
  store.addAudit(
    params.site.organizationId,
    spec.name,
    'system',
    'Collection Prompt Dispatched',
    `${tx.reference} (${tx.provider} · TZS ${tx.amountTzs.toLocaleString()})`
  );
  store.save();
  return tx;
}

export function verifyGatewayWebhookSignature(
  gatewayCode: PaymentGatewayCode,
  rawPayload: string,
  providedSignature: string | undefined
): boolean {
  const spec = GATEWAY_SPECS.find((g) => g.code === gatewayCode);
  if (!spec) return false;
  const secret = process.env[spec.webhookSecretEnv]?.trim();
  if (!secret || !providedSignature) return false;

  const expectedHex = crypto.createHmac('sha256', secret).update(rawPayload).digest('hex');
  const providedClean = providedSignature.trim();
  const a = Buffer.from(providedClean);
  const b = Buffer.from(expectedHex);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
