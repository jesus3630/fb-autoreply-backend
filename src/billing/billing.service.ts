import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import * as StripeLib from 'stripe';
import { User, UserTier } from '../users/user.entity';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const Stripe = require('stripe');

export const STRIPE_PRICES: Record<string, UserTier> = {
  price_starter_monthly: UserTier.STARTER,
  price_pro_monthly: UserTier.PRO,
  price_business_monthly: UserTier.BUSINESS,
  price_agency_monthly: UserTier.AGENCY,
};

@Injectable()
export class BillingService {
  private stripe: any;

  constructor(
    @InjectRepository(User) private users: Repository<User>,
    private config: ConfigService,
  ) {
    this.stripe = new Stripe(this.config.get<string>('STRIPE_SECRET_KEY'));
  }

  async createCheckoutSession(userId: string, priceId: string, successUrl: string, cancelUrl: string) {
    const user = await this.users.findOneOrFail({ where: { id: userId } });

    let customerId = user.stripeCustomerId;
    if (!customerId) {
      const customer = await this.stripe.customers.create({ email: user.email, metadata: { userId } });
      customerId = customer.id;
      await this.users.update(userId, { stripeCustomerId: customerId });
    }

    const session = await this.stripe.checkout.sessions.create({
      customer: customerId,
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: { userId },
    });

    return { url: session.url };
  }

  async createPortalSession(userId: string, returnUrl: string) {
    const user = await this.users.findOneOrFail({ where: { id: userId } });
    if (!user.stripeCustomerId) throw new BadRequestException('No billing account found');

    const session = await this.stripe.billingPortal.sessions.create({
      customer: user.stripeCustomerId,
      return_url: returnUrl,
    });

    return { url: session.url };
  }

  async handleWebhook(rawBody: Buffer, sig: string) {
    const secret = this.config.get<string>('STRIPE_WEBHOOK_SECRET');
    let event: any;

    try {
      event = this.stripe.webhooks.constructEvent(rawBody, sig, secret);
    } catch {
      throw new BadRequestException('Invalid webhook signature');
    }

    switch (event.type) {
      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const sub = event.data.object;
        const priceId = sub.items.data[0]?.price.id;
        const tier = STRIPE_PRICES[priceId] ?? UserTier.STARTER;
        await this.users.update(
          { stripeCustomerId: sub.customer },
          {
            tier,
            stripeSubscriptionId: sub.id,
            stripeSubscriptionStatus: sub.status,
            subscriptionEndsAt: new Date(sub.current_period_end * 1000),
          },
        );
        break;
      }
      case 'customer.subscription.deleted': {
        const sub = event.data.object;
        await this.users.update(
          { stripeCustomerId: sub.customer },
          { tier: UserTier.STARTER, stripeSubscriptionStatus: 'canceled' },
        );
        break;
      }
    }

    return { received: true };
  }
}
