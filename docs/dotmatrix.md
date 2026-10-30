# Dot Matrix adaptation

Source design: [Core Spiral / dotm-square-3](https://dotmatrix.zzzzshawn.cloud/getting-started/usage).

This app uses a small, independently implemented HTML/CSS adaptation of the published 5 × 5 clockwise spiral loading pattern. It does not include the upstream React components, hooks or stylesheet, and it does not install React, Tailwind or shadcn. The official registry remains the installation route for React applications.

The loader appears only while the checked-in fixtures are fetched, hashed and normalized. It stops on success or error, respects reduced motion, and shares the existing textual loading status. No artificial loading delay or third-party runtime request is added.
