import { describe, it, beforeEach } from 'mocha';
import { expect } from 'chai';
import NodeValues from '../src/utils/nodevalues';

describe('NodeValues', () => {
    let nodeValues: NodeValues;

    beforeEach(() => {
        nodeValues = new NodeValues({
            'a': 'foo',
            'b': 'foo',
            'c': 'bar',
        })
    });

    it('quick and dirty test', () => {
        expect(nodeValues.getMostPopularValue()).to.eq('foo');

        nodeValues.setNodeValue('d', 'bar');

        expect(nodeValues.getMostPopularValue()).to.eq('bar'); // tie broken by lower in alphabet

        expect(nodeValues.getNodeValue('a')).to.eq('foo');
        expect(nodeValues.getNodeValue('b')).to.eq('foo');
        expect(nodeValues.getNodeValue('c')).to.eq('bar');
        expect(nodeValues.getNodeValue('d')).to.eq('bar');
        expect(nodeValues.getNodeValue('e')).to.eq(null);

        nodeValues.deleteNodeValue('c');
        expect(nodeValues.getNodeValue('c')).to.eq(null);
        expect(nodeValues.getMostPopularValue()).to.eq('foo');

        nodeValues.setNodeValue('a', 'bar');
        expect(nodeValues.getMostPopularValue()).to.eq('bar');

        nodeValues.deleteNodeValue('a');
        nodeValues.deleteNodeValue('b');
        nodeValues.deleteNodeValue('d');

        expect(nodeValues.getMostPopularValue()).to.eq(null);
    })
})
