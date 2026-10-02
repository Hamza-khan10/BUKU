/**
 * Unit economics (D-065): what each price really earns once tax and the sales
 * channel's cut are taken out, what everything costs to run, and how many
 * subscribers break even. Pure arithmetic in cents: the admin API feeds it the
 * current catalog, fees, costs and subscriber counts (real or "what if").
 *
 *   price excludes tax: customer pays amount + tax; the tax goes to the state
 *   price includes tax: the tax is inside the amount
 *   channel fee: percent of what the customer pays + a fixed amount
 *     (conservative: stores take their cut of the price before tax)
 *
 * Costs are monthly, in USD; yearly prices count as 1/12 per month. Prices in
 * other currencies are listed but not added to the USD totals.
 */

export interface EconomicsPrice {
  priceId: string;
  planCode: string;
  planName: string;
  channel: string;
  currency: string;
  amount: number;
  interval: 'month' | 'year';
  taxInclusive: boolean;
  subscribers: number;
}

export interface EconomicsInput {
  prices: EconomicsPrice[];
  fees: Record<string, { percent: number; fixedAmount: number }>;
  monthlyCosts: number;
  /** Sales tax / VAT rate to assume, in percent. */
  taxPercent: number;
}

const cents = (n: number) => Math.round(n * 100);
const money = (c: number) => (c / 100).toFixed(2);

export function computeEconomics(input: EconomicsInput) {
  const rate = input.taxPercent / 100;
  const costCents = cents(input.monthlyCosts);

  const rows = input.prices.map((p) => {
    const perMonth = p.interval === 'year' ? cents(p.amount) / 12 : cents(p.amount);
    const customerPays = p.taxInclusive ? perMonth : perMonth * (1 + rate);
    const tax = p.taxInclusive ? perMonth - perMonth / (1 + rate) : perMonth * rate;
    const fee = input.fees[p.channel] ?? { percent: 0, fixedAmount: 0 };
    const fixedPerMonth = p.interval === 'year' ? cents(fee.fixedAmount) / 12 : cents(fee.fixedAmount);
    const channelFee = customerPays * (fee.percent / 100) + fixedPerMonth;
    const net = Math.round(customerPays - tax - channelFee);
    const inTotals = p.currency === 'USD';
    return {
      priceId: p.priceId,
      plan: p.planCode,
      planName: p.planName,
      channel: p.channel,
      currency: p.currency,
      interval: p.interval,
      price: money(cents(p.amount)),
      perSubscriberPerMonth: {
        customerPays: money(Math.round(customerPays)),
        tax: money(Math.round(tax)),
        channelFee: money(Math.round(channelFee)),
        net: money(net),
        /** Share of what the customer pays that BUKU keeps. */
        keepPercent: customerPays > 0 ? Math.round((net / customerPays) * 1000) / 10 : 0,
      },
      subscribers: p.subscribers,
      monthlyNet: money(net * p.subscribers),
      /** Subscribers of this price alone that would cover all running costs. */
      breakEvenSubscribers: net > 0 ? Math.ceil(costCents / net) : null,
      includedInTotals: inTotals,
      _net: inTotals ? net * p.subscribers : 0,
      _gross: inTotals ? Math.round(customerPays) * p.subscribers : 0,
    };
  });

  const revenueNet = rows.reduce((sum, r) => sum + r._net, 0);
  const revenueGross = rows.reduce((sum, r) => sum + r._gross, 0);
  const profit = revenueNet - costCents;
  return {
    currency: 'USD',
    assumptions: { taxPercent: input.taxPercent, monthlyCosts: money(costCents) },
    prices: rows.map(({ _net, _gross, ...r }) => r),
    totals: {
      subscribers: rows.filter((r) => r.includedInTotals).reduce((sum, r) => sum + r.subscribers, 0),
      customersPayPerMonth: money(revenueGross),
      netRevenuePerMonth: money(revenueNet),
      costsPerMonth: money(costCents),
      profitPerMonth: money(profit),
      marginPercent: revenueNet > 0 ? Math.round((profit / revenueNet) * 1000) / 10 : null,
    },
  };
}
