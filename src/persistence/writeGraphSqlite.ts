import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { graph } from "../graph/graph";

export default function writeGraphSqlite(
    databasePath: string = "sqlite/Graph.sqlite"
): void {
    const dir = path.dirname(databasePath);

    if (dir && dir !== ".") {
        fs.mkdirSync(dir, { recursive: true });
    }

    const db = new Database(databasePath);

    db.exec(`
        DROP TABLE IF EXISTS nodes;
        DROP TABLE IF EXISTS edges;

        CREATE TABLE nodes (
            id TEXT PRIMARY KEY,
            parent TEXT,
            type TEXT NOT NULL,
            name TEXT NOT NULL,
            file TEXT,
            is_static INTEGER,
            visibility TEXT,
            scope TEXT,
            data_type TEXT,
            start_row INTEGER,
            start_column INTEGER,
            end_row INTEGER,
            end_column INTEGER,
            keywords TEXT,
            description TEXT,
            raw_json TEXT NOT NULL
        );

        CREATE TABLE edges (
            id TEXT PRIMARY KEY,
            from_id TEXT NOT NULL,
            to_id TEXT NOT NULL,
            type TEXT NOT NULL,
            call_type TEXT,
            via TEXT,
            argument_index INTEGER,
            confidence REAL,
            reason TEXT,
            raw_json TEXT NOT NULL
        );

        CREATE INDEX idx_nodes_type ON nodes(type);
        CREATE INDEX idx_nodes_parent ON nodes(parent);
        CREATE INDEX idx_nodes_file ON nodes(file);
        CREATE INDEX idx_nodes_scope ON nodes(scope);
        CREATE INDEX idx_edges_type ON edges(type);
        CREATE INDEX idx_edges_from ON edges(from_id);
        CREATE INDEX idx_edges_to ON edges(to_id);
        CREATE INDEX idx_edges_via ON edges(via);
    `);

    const insertNode = db.prepare(`
        INSERT INTO nodes (
            id,
            parent,
            type,
            name,
            file,
            is_static,
            visibility,
            scope,
            data_type,
            start_row,
            start_column,
            end_row,
            end_column,
            keywords,
            description,
            raw_json
        ) VALUES (
            @id,
            @parent,
            @type,
            @name,
            @file,
            @is_static,
            @visibility,
            @scope,
            @data_type,
            @start_row,
            @start_column,
            @end_row,
            @end_column,
            @keywords,
            @description,
            @raw_json
        );
    `);

    const insertEdge = db.prepare(`
        INSERT INTO edges (
            id,
            from_id,
            to_id,
            type,
            call_type,
            via,
            argument_index,
            confidence,
            reason,
            raw_json
        ) VALUES (
            @id,
            @from_id,
            @to_id,
            @type,
            @call_type,
            @via,
            @argument_index,
            @confidence,
            @reason,
            @raw_json
        );
    `);

    const transaction = db.transaction(() => {
        for (const node of graph.nodes.values()) {
            insertNode.run({
                id: node.id,
                parent: node.parent ?? null,
                type: node.type,
                name: node.name,
                file: node.file ?? null,
                is_static: node.isStatic === undefined
                    ? null
                    : Number(node.isStatic),
                visibility: node.visibility ?? null,
                scope: node.scope ?? null,
                data_type: node.dataType ?? null,
                start_row: node.startPosition?.row ?? null,
                start_column: node.startPosition?.column ?? null,
                end_row: node.endPosition?.row ?? null,
                end_column: node.endPosition?.column ?? null,
                keywords: JSON.stringify(node.keywords ?? []),
                description: node.description ?? null,
                raw_json: JSON.stringify(node),
            });
        }

        for (const [edgeId, edge] of graph.edges.entries()) {
            insertEdge.run({
                id: edgeId,
                from_id: edge.from,
                to_id: edge.to,
                type: edge.type,
                call_type: edge.callType ?? null,
                via: edge.via ?? null,
                argument_index: edge.argumentIndex ?? null,
                confidence: edge.confidence ?? null,
                reason: edge.reason ?? null,
                raw_json: JSON.stringify(edge),
            });
        }
    });

    transaction();
    db.close();
}