import assert from "node:assert/strict";
import { resolveTicketPath } from "./ticketInput";

function testFlagPath(): void {
    assert.equal(resolveTicketPath(["--ticket=tickets/a.txt", "--json"]), "tickets/a.txt");
}

function testPositionalPath(): void {
    assert.equal(resolveTicketPath(["tickets/a.txt"]), "tickets/a.txt");
}

function testNpmConfigFallback(): void {
    const previous = process.env.npm_config_ticket;
    process.env.npm_config_ticket = "tickets/from-npm.txt";

    try {
        assert.equal(resolveTicketPath([]), "tickets/from-npm.txt");
        assert.equal(resolveTicketPath(["--json"]), "tickets/from-npm.txt");
    } finally {
        if (previous === undefined) {
            delete process.env.npm_config_ticket;
        } else {
            process.env.npm_config_ticket = previous;
        }
    }
}

function run(): void {
    testFlagPath();
    testPositionalPath();
    testNpmConfigFallback();
    console.log("ticketInput tests passed.");
}

run();
