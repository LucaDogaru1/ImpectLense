import Database from "better-sqlite3";
import { findDeadCode } from "./DeadCodeAnalyzer";

function createTestDb(): Database.Database {
    const db = new Database(":memory:");

    db.exec(`
        CREATE TABLE nodes (
            id TEXT PRIMARY KEY,
            parent TEXT,
            type TEXT NOT NULL,
            name TEXT NOT NULL,
            file TEXT,
            visibility TEXT,
            raw_json TEXT NOT NULL
        );

        CREATE TABLE edges (
            id TEXT PRIMARY KEY,
            from_id TEXT NOT NULL,
            to_id TEXT NOT NULL,
            type TEXT NOT NULL,
            call_type TEXT,
            via TEXT
        );
    `);

    return db;
}

function insertNode(
    db: Database.Database,
    node: {
        id: string;
        parent?: string;
        type: string;
        name: string;
        file?: string;
        visibility?: string;
        isAbstract?: boolean;
    }
): void {
    db.prepare(`
        INSERT INTO nodes (id, parent, type, name, file, visibility, raw_json)
        VALUES (@id, @parent, @type, @name, @file, @visibility, @raw_json)
    `).run({
        id: node.id,
        parent: node.parent ?? null,
        type: node.type,
        name: node.name,
        file: node.file ?? null,
        visibility: node.visibility ?? null,
        raw_json: JSON.stringify({ isAbstract: node.isAbstract === true }),
    });
}

function insertEdge(
    db: Database.Database,
    edge: { id: string; from_id: string; to_id: string; type: string; call_type?: string }
): void {
    db.prepare(`
        INSERT INTO edges (id, from_id, to_id, type, call_type)
        VALUES (@id, @from_id, @to_id, @type, @call_type)
    `).run({
        id: edge.id,
        from_id: edge.from_id,
        to_id: edge.to_id,
        type: edge.type,
        call_type: edge.call_type ?? null,
    });
}

function testAbstractImplementationIgnored(): void {
    const db = createTestDb();

    insertNode(db, { id: "Area", type: "class", name: "Area" });
    insertNode(db, {
        id: "Area::getPossibleElements",
        parent: "Area",
        type: "method",
        name: "getPossibleElements",
        visibility: "public",
        isAbstract: true,
    });
    insertNode(db, { id: "DvvNewsletterArea", type: "class", name: "DvvNewsletterArea" });
    insertNode(db, {
        id: "DvvNewsletterArea::getPossibleElements",
        parent: "DvvNewsletterArea",
        type: "method",
        name: "getPossibleElements",
        visibility: "public",
        file: "modules/DvvNewsletterArea.php",
    });
    insertNode(db, {
        id: "DvvNewsletterArea::getName",
        parent: "DvvNewsletterArea",
        type: "method",
        name: "getName",
        visibility: "public",
        file: "modules/DvvNewsletterArea.php",
    });

    insertEdge(db, {
        id: "extends",
        from_id: "DvvNewsletterArea",
        to_id: "Area",
        type: "EXTENDS",
    });

    const result = findDeadCode(db);

    if (result.items.some(item => item.id === "DvvNewsletterArea::getPossibleElements")) {
        throw new Error("expected abstract implementation getPossibleElements to be ignored");
    }

    if (!result.items.some(item => item.id === "DvvNewsletterArea::getName")) {
        throw new Error("expected unrelated method getName to remain a dead candidate");
    }
}

function testOverrideResolvedCountsAsUsed(): void {
    const db = createTestDb();

    insertNode(db, { id: "Element", type: "class", name: "Element" });
    insertNode(db, {
        id: "Element::onSave",
        parent: "Element",
        type: "method",
        name: "onSave",
        visibility: "public",
    });
    insertNode(db, { id: "InstagramElement", type: "class", name: "InstagramElement" });
    insertNode(db, {
        id: "InstagramElement::onSave",
        parent: "InstagramElement",
        type: "method",
        name: "onSave",
        visibility: "public",
        file: "app/InstagramElement.php",
    });
    insertNode(db, {
        id: "Service::save",
        type: "method",
        name: "save",
        visibility: "public",
    });

    insertEdge(db, {
        id: "extends",
        from_id: "InstagramElement",
        to_id: "Element",
        type: "EXTENDS",
    });
    insertEdge(db, {
        id: "call",
        from_id: "Service::save",
        to_id: "Element::onSave",
        type: "CALLS",
    });
    insertEdge(db, {
        id: "override",
        from_id: "Service::save",
        to_id: "InstagramElement::onSave",
        type: "CALLS",
        call_type: "OVERRIDE_RESOLVED",
    });

    const result = findDeadCode(db);

    if (result.items.some(item => item.id === "InstagramElement::onSave")) {
        throw new Error("expected override method to be treated as used via OVERRIDE_RESOLVED");
    }
}

testAbstractImplementationIgnored();
testOverrideResolvedCountsAsUsed();
console.log("DeadCodeAnalyzer tests passed");
