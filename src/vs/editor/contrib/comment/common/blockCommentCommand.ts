/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';

import { EditOperation } from 'vs/editor/common/core/editOperation';
import { Position } from 'vs/editor/common/core/position';
import { Range } from 'vs/editor/common/core/range';
import { Selection } from 'vs/editor/common/core/selection';
import * as editorCommon from 'vs/editor/common/editorCommon';
import { ICommentsConfiguration, LanguageConfigurationRegistry } from 'vs/editor/common/modes/languageConfigurationRegistry';
import { CharCode } from 'vs/base/common/charCode';

export class BlockCommentCommand implements editorCommon.ICommand {

	private _selection: Selection;
	private _usedEndToken: string;

	constructor(selection: Selection) {
		this._selection = selection;
		this._usedEndToken = null;
	}

	public static _haystackHasNeedleAtOffset(haystack: string, needle: string, offset: number): boolean {
		if (offset < 0) {
			return false;
		}
		const needleLength = needle.length;
		const haystackLength = haystack.length;
		if (offset + needleLength > haystackLength) {
			return false;
		}
		for (let i = 0; i < needleLength; i++) {
			if (haystack.charCodeAt(offset + i) !== needle.charCodeAt(i)) {
				return false;
			}
		}
		return true;
	}

	private _createOperationsForBlockComment(selection: Range, config: ICommentsConfiguration, model: editorCommon.ITokenizedModel, builder: editorCommon.IEditOperationBuilder): void {
		const startLineNumber = selection.startLineNumber;
		const startColumn = selection.startColumn;
		const endLineNumber = selection.endLineNumber;
		const endColumn = selection.endColumn;

		let startToken = config.blockCommentStartToken;
		let endToken = config.blockCommentEndToken;

		const startTokenIndex = model.getLineContent(startLineNumber).lastIndexOf(startToken, startColumn - 1 + startToken.length);
		let endTokenIndex = model.getLineContent(endLineNumber).indexOf(endToken, endColumn - 1 - endToken.length);

		let ops: editorCommon.IIdentifiedSingleEditOperation[];

		if (startTokenIndex !== -1 && endTokenIndex !== -1) {
			const endTokenBeforeCursorIndex = model.getLineContent(startLineNumber).lastIndexOf(endToken, startColumn - 1 + endToken.length);
			if (endTokenBeforeCursorIndex > startTokenIndex + startToken.length - 1) {
				ops = BlockCommentCommand._createAddBlockCommentOperations(selection, startToken, endToken);
				this._usedEndToken = ops.length === 1 ? endToken : null;
			} else {
				// We have to adjust to possible inner white space
				// For Space after startToken, add Space to startToken - range math will work out
				if (model.getLineContent(startLineNumber).charCodeAt(startTokenIndex + startToken.length) === CharCode.Space) {
					startToken += ' ';
				}
				// For Space before endToken, add Space before endToken and shift index one left
				if (model.getLineContent(endLineNumber).charCodeAt(endTokenIndex - 1) === CharCode.Space) {
					endToken = ' ' + endToken;
					endTokenIndex -= 1;
				}
				ops = BlockCommentCommand._createRemoveBlockCommentOperations(
					new Range(startLineNumber, startTokenIndex + 1 + startToken.length, endLineNumber, endTokenIndex + 1), startToken, endToken
				);
			}
		} else {
			ops = BlockCommentCommand._createAddBlockCommentOperations(selection, startToken, endToken);
			this._usedEndToken = ops.length === 1 ? endToken : null;
		}

		for (let i = 0; i < ops.length; i++) {
			builder.addTrackedEditOperation(ops[i].range, ops[i].text);
		}
	}

	public static _createRemoveBlockCommentOperations(r: Range, startToken: string, endToken: string): editorCommon.IIdentifiedSingleEditOperation[] {
		let res: editorCommon.IIdentifiedSingleEditOperation[] = [];

		if (!Range.isEmpty(r)) {
			// Remove block comment start
			res.push(EditOperation.delete(new Range(
				r.startLineNumber, r.startColumn - startToken.length,
				r.startLineNumber, r.startColumn
			)));

			// Remove block comment end
			res.push(EditOperation.delete(new Range(
				r.endLineNumber, r.endColumn,
				r.endLineNumber, r.endColumn + endToken.length
			)));
		} else {
			// Remove both continuously
			res.push(EditOperation.delete(new Range(
				r.startLineNumber, r.startColumn - startToken.length,
				r.endLineNumber, r.endColumn + endToken.length
			)));
		}

		return res;
	}

	public static _createAddBlockCommentOperations(r: Range, startToken: string, endToken: string): editorCommon.IIdentifiedSingleEditOperation[] {
		let res: editorCommon.IIdentifiedSingleEditOperation[] = [];

		if (!Range.isEmpty(r)) {
			// Insert block comment start
			res.push(EditOperation.insert(new Position(r.startLineNumber, r.startColumn), startToken + ' '));

			// Insert block comment end
			res.push(EditOperation.insert(new Position(r.endLineNumber, r.endColumn), ' ' + endToken));
		} else {
			// Insert both continuously
			res.push(EditOperation.replace(new Range(
				r.startLineNumber, r.startColumn,
				r.endLineNumber, r.endColumn
			), startToken + '  ' + endToken));
		}

		return res;
	}

	public getEditOperations(model: editorCommon.ITokenizedModel, builder: editorCommon.IEditOperationBuilder): void {
		const startLineNumber = this._selection.startLineNumber;
		const startColumn = this._selection.startColumn;

		model.tokenizeIfCheap(startLineNumber);
		let languageId = model.getLanguageIdAtPosition(startLineNumber, startColumn);
		let config = LanguageConfigurationRegistry.getComments(languageId);
		if (!config || !config.blockCommentStartToken || !config.blockCommentEndToken) {
			// Mode does not support block comments
			return;
		}

		this._createOperationsForBlockComment(
			this._selection, config, model, builder
		);
	}

	public computeCursorState(model: editorCommon.ITokenizedModel, helper: editorCommon.ICursorStateComputerData): Selection {
		const inverseEditOperations = helper.getInverseEditOperations();
		if (inverseEditOperations.length === 2) {
			const startTokenEditOperation = inverseEditOperations[0];
			const endTokenEditOperation = inverseEditOperations[1];

			return new Selection(
				startTokenEditOperation.range.endLineNumber,
				startTokenEditOperation.range.endColumn,
				endTokenEditOperation.range.startLineNumber,
				endTokenEditOperation.range.startColumn
			);
		} else {
			const srcRange = inverseEditOperations[0].range;
			const deltaColumn = this._usedEndToken ? -this._usedEndToken.length - 1 : 0; // minus 1 space before endToken
			return new Selection(
				srcRange.endLineNumber,
				srcRange.endColumn + deltaColumn,
				srcRange.endLineNumber,
				srcRange.endColumn + deltaColumn
			);
		}
	}
}
