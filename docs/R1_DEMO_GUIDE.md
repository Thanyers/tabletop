# Try the local R1 candidate

This guide covers the three original workflows in the **local Node guest runtime**. For hosted Google accounts, file-driven Shared data tables, interactive public practice and saved multiplayer rooms, use the [current user guide](USER_GUIDE_TH.md). Local upload/session limits below are not the Cloudflare generic-table limits.

Start the app using [Local development](LOCAL_DEVELOPMENT.md), then open `http://127.0.0.1:4310`. Use synthetic inputs. No API key is needed. **Canvas** contains working objects; **Focus table** opens the longer forms and evidence details. Use **Arrange** to reposition objects, **Use** to interact, **Focus object** for one object, and **Fit objects** for an overview.

## Invoice: import, review, change a rate, export

1. Create **Invoice check**. Open **Focus table** and download the sample shipment CSV, invoice PDF, and rate-card PDF.
2. Import all three. Each import starts as `provided`. Open each source, inspect the text or download its original, then choose **Verify**. Unreviewed shipment/invoice sources keep their comparisons unresolved.
3. In **Draft a dated rate change**, select **Remote surcharge**, **All zones**, **750** satang, and start date **2026-10-20**. Leave the end date empty. Select the reviewed `rate-card.pdf` evidence.
4. Choose **Propose this rate**, then **Simulate**, **Validate**, **Approve**, and **Activate**. The active rules remain unchanged until activation succeeds.
5. The sample expected total becomes **THB 155.00**, equal to billed. `ALT-BKK-20` is **THB 52.50**, `ALT-REG-20` is **THB 62.50**, and `ALT-BOUNDARY` is **THB 40.00**. The earlier boundary row has no new surcharge.
6. Select a row to open its supporting sources. Export **CSV** or **Report**, choose **Save run**, and refresh. The accepted result and sources should remain. Rollback creates another rule revision; it does not erase the saved run.

The PDF template is intentionally bounded. Use `invoice.csv` for the CSV alternative. Importing another period replaces current rows of that dataset rather than appending them.

## Teaching: teacher and two learners

1. Create **Physics lesson** in a normal browser profile.
2. Open **People at this table**, choose **Learner 1**, and create an invitation. Open it in a separate browser profile/private context. Repeat for **Learner 2** in another independent context. Two tabs in the same profile share a cookie and are not distinct actors.
3. Change the shared mass to **5 kg** and choose **Update lesson**. With the initial force/time, the shared position is **4 m**.
4. In Learner 1's own view, change mass to **2 kg**. That local experiment shows **10 m** without changing the teacher's shared lesson.
5. The teacher can assign Learner 1 a graph and advanced level. Learner 2 retains their own representation. Learner 1 can answer **4** for the shared question; the teacher sees the feedback, while Learner 2 does not see the answer.
6. Save a private teacher note and refresh. Learner views never receive that note. Resetting the teacher's table revokes the old learner invitations/sessions for that workspace; create new invitations to rejoin.

## Encounter: DM and two players

1. Create **Shared encounter**. Invite **Mira** and **Pip** into separate browser contexts.
2. The DM can save a private note. Player payloads omit DM notes and the hidden goblin; pending damage/roll values remain hidden until resolution.
3. Propose a shield rule that allows shielding an ally, costs **1 AP**, and can be used once per character turn. Simulate, validate, approve, and activate it.
4. As DM, choose **Hit Pip**. As Mira, choose **Shield Pip as ally** before the reaction window closes. As DM, choose **Resolve hit**.
5. Pip has **8/10 HP** and Mira has **1 AP**. End the current turn to restore Mira to **2 AP**. Refresh Pip's view to verify the HP persists.

These are separate authenticated sessions connected to one local server. They are not a simulated multi-view presentation. Testing on two physical devices and over a hosted network is still pending.

## Recovery and limits

- A stale-change notice means another accepted change won; refresh before submitting a new command.
- Automatic network retry preserves the same command ID. Accepted commands are deduplicated on the server.
- Layout and viewport are stored per workspace/epoch in the browser; authoritative content stays on the server.
- **Reset table** starts a fresh epoch and revokes invited actors. Workspace content expires after seven days.
- Manual rule editing works without AI. Live AI, public uploads, and hosted access are not enabled by this local guide.
