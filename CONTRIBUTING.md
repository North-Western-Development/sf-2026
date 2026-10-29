# Contributing

Thanks for helping with Subspace Frequency.

## Before you start

- **Agree to the [Contributor License Agreement](CLA.md).** Every pull request must check the agreement box in its description; a check on the pull request fails until it is checked. You keep the copyright in your work. The agreement lets North Western Development offer it under the free and the commercial licenses ([LICENSING.md](LICENSING.md)).
- **Security problems:** report them privately to april.abney@northwesterndevelopment.com, never in a public issue or pull request.
- For anything large, open an issue first so we can agree on the approach.

## Making a change

1. Set up the project with the [local development guide](apps/docs/guide/local-development.md).
2. Keep each pull request to one change, and match the code around it.
3. Add or update tests, and run the suites your change touches:
   ```bash
   pnpm test:native    # backend
   pnpm test:ui        # browser tests
   pnpm test:web       # web app unit tests
   ```
4. A schema change ships with its generated migration (`pnpm --filter @subspace/database db:generate`).
5. Update the documentation in `apps/docs` when behavior changes.

## AI-assisted contributions

Much of this project was written with AI assistance, and that is fine for contributions too. Review AI output as carefully as your own, make sure you have the right to submit it, and say in the pull request if a substantial part of it was AI-generated.
