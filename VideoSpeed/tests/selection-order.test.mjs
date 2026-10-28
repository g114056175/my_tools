import test from 'node:test';
import assert from 'node:assert/strict';
import {SelectionOrder} from '../src/selection-order.js';
test('late selection and conflicting acknowledgements cannot restore an old target',()=>{
 const order=new SelectionOrder();
 assert.equal(order.accept({selectionEpoch:100,selectionRevision:2,id:'B'}),true);
 assert.equal(order.accept({selectionEpoch:100,selectionRevision:1,id:'A'}),false);
 assert.equal(order.accept({selectionEpoch:100,selectionRevision:2,id:'A'}),false);
 assert.equal(order.accept({selectionEpoch:100,selectionRevision:2,id:'B'}),true);
});
test('a restarted worker can send a lower revision while old-worker deliveries remain stale',()=>{
 const order=new SelectionOrder();order.accept({selectionEpoch:100,selectionRevision:10,id:'A'});
 assert.equal(order.accept({selectionEpoch:200,selectionRevision:1,id:'B'}),true);
 assert.equal(order.accept({selectionEpoch:100,selectionRevision:11,id:'A'}),false);
 assert.equal(order.accept({id:'A'}),false);
});
