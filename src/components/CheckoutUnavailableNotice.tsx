// The Billing page's banner while new subscriptions cannot be started (Stripe checkout is
// unavailable): what is happening and who to contact.

export function CheckoutUnavailableNotice({ contactEmail }: { contactEmail?: string | null }) {
  return (
    <div
      role="status"
      data-testid="checkout-unavailable"
      className="mt-6 rounded-xl border border-warning/30 bg-warning/10 p-4 text-sm"
    >
      <p className="font-semibold text-warning">New subscriptions aren't available yet.</p>
      <p className="mt-1 text-muted-foreground">
        Plan selection is turned off until subscription payments open. Please check back soon
        {contactEmail ? (
          <>
            {" "}
            or contact{" "}
            <a href={`mailto:${contactEmail}`} className="font-medium underline">
              {contactEmail}
            </a>
          </>
        ) : (
          " or contact support"
        )}
        .
      </p>
    </div>
  );
}
