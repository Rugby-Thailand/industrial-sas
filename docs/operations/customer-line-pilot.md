# Customer LINE group pilot

Use a dedicated LINE Official Account and a test group. The first UI opens **Customers → LINE** for the organization's primary account. Each connected account has its own webhook and outgoing message queue. LINE allows one OA in a group at a time. [LINE group setup](https://developers.line.biz/en/docs/messaging-api/group-chats/)

## Prepare the account and verify the first group

An operator enables the pilot organization using `customerLine/provision:grantOrgAdminLineAccess` on its Convex deployment with the internal `orgId`. This only grants LINE access to the eligible seeded organization administrator role. Confirm the intended group's staff have the appropriate LINE read, manage, or send grants. The accounts and groups are still disconnected until an admin completes setup.

1. Set `LINE_SECRETS_KEY` on the pilot Convex deployment to a stable, base64-encoded 32-byte key. Keep a recoverable copy in the deployment's secret manager. Changing that key makes existing encrypted LINE credentials unreadable.
2. In **Customers → LINE → Settings**, enter the OA's channel secret and channel access token. Confirm the displayed OA name and handle. Copy the webhook URL into the account's Messaging API settings in the LINE Developers Console. Enable **Use webhook**, **Webhook redelivery**, and **Allow bot to join group chats**. Turn off LINE's automatic greeting and response if they would interfere with the test. [LINE webhook verification](https://developers.line.biz/en/docs/messaging-api/verify-webhook-url/)
3. Verify the webhook in LINE Developers Console and invite the account into the test group. In Yongkit, select that group for the connection test. Confirm the neutral test message in LINE. This is the only setup step that sends a message to the group.
4. In Yongkit's LINE inbox, approve the group only after confirming it with a known representative of the customer company. Explain that everyone in the group can see replies. Verify the business relationship separately before giving individual participants a named contact role.

## Check both sides of a conversation

Have two group members mention the OA with different questions. Check that the inbox creates one request per question, ordinary group chat stays out of the inbox, and group-safe staff replies go back to the same group. Check each reply on both LINE clients. A status of **Accepted by LINE** records acceptance of the API request.

Use a synthetic name and order number. Keep personal data, invoices, and other restricted information in a separately authorized channel. If a verified contact leaves the company, revoke the role. A signed LINE member departure also revokes the role, so returning members need fresh verification. The customer manages who remains a member in LINE. Pause replies that reveal customer details until the audience is confirmed if a former employee remains in the group.

## Pause, disconnect, and resume

- **Pause a group** to stop its intake and sends. Resume for new questions.
- **Disconnect a group** to end the customer link. If the OA remains in the group, use **Request reapproval** to start a fresh enrollment. If the OA leaves, invite it again and approve the new join. Each new enrollment has its own questions and verified contacts.
- **Disconnect the OA** to stop the account's sends. Record the prior webhook endpoint before a change to an existing OA, so it can be restored during an agreed cutover. On reconnect, check the OA identity, signed webhook, and test group again before using it. If the OA remains in every existing group, use a dedicated new test group or request reapproval for an existing test group.

A LINE request already in flight when staff pause or disconnect may still be accepted. Recheck the outgoing state before sending the same answer manually if a request timed out. [LINE retry keys](https://developers.line.biz/en/docs/messaging-api/retrying-api-request/)
