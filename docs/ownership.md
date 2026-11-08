# Maintenance and OMP adoption

This repository is maintained under `irvinebroque` so the executable example can be tested and released independently of protocol working drafts. The original Cloudflare prototype’s subtree history is retained. Apache-2.0 licensing and pinned third-party rule licenses travel with the code.

The OMP repository should own the normative working drafts, profiles, semantic conventions and any shared interoperability fixtures the working group agrees to adopt. This repository owns the Cloudflare deployment, storage adapter, browser demo, SDK and executable checks. It links to the draft rather than copying a competing specification.

The proposed next step is a documentation link describing this as a community implementation example. If OMP maintainers want to adopt it, the repository can be transferred into their organization with its history, issues, releases and CI intact. Calling it an official reference implementation requires their explicit decision and agreement on supported draft versions, maintenance and review.

Suggested adoption discussion: who maintains Cloudflare beta API changes, who approves protocol compatibility updates, where shared fixtures should live, and whether the project wants a platform-specific reference or a broader implementation directory. Publishing this example does not imply the working group has endorsed any experimental binding here.
