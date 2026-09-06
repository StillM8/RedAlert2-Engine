import { test } from '../harness/fixtures';
import { expectImportPrompt, expectMainMenu, expectSkirmishLobby } from '../harness/GameAssertions';

test('@smoke boots to the legal user-content import prompt', async ({ engine, diagnostics }) => {
    await engine.boot({ importAssets: false });
    await expectImportPrompt(engine.page);
    diagnostics.assertNoPageErrors();
});

test('@assets imports the supplied profile through the normal folder picker and opens the menu', async ({ engine, diagnostics }) => {
    await engine.boot({ importAssets: true });
    await expectMainMenu(engine.page);
    await engine.openSkirmish();
    await expectSkirmishLobby(engine.page);
    diagnostics.assertNoPageErrors();
});
