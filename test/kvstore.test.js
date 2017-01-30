'use strict'

const assert = require('assert')
const rmrf = require('rimraf')
const OrbitDB = require('../src/OrbitDB')
const hasIpfsApiWithPubsub = require('./test-utils').hasIpfsApiWithPubsub
const config = require('./test-config')

config.daemons.forEach((IpfsDaemon) => {

  describe('orbit-db - Key-Value Store', function() {
    this.timeout(config.timeout)

    let ipfs, client1, client2, db

    before(function (done) {
      rmrf.sync(config.defaultIpfsDirectory)
      rmrf.sync(config.defaultOrbitDBDirectory)
      ipfs = new IpfsDaemon()
      ipfs.on('error', done)
      ipfs.on('ready', () => {
        assert.equal(hasIpfsApiWithPubsub(ipfs), true)
        client1 = new OrbitDB(ipfs)
        client2 = new OrbitDB(ipfs)
        done()
      })
    })

    after(() => {
      if(client1) client1.disconnect()
      if(client2) client2.disconnect()
      ipfs.stop()
      rmrf.sync(config.defaultOrbitDBDirectory)
      rmrf.sync(config.defaultIpfsDirectory)
    })

    beforeEach(() => {
      db = client1.kvstore(config.dbname, { replicate: false, maxHistory: 0 })
    })

    it('put', () => {
      return db.put('key1', 'hello1')
        .then(() => {
          const value = db.get('key1')
          assert.equal(value, 'hello1')
        })
    })

    it('get', () => {
      return db.put('key1', 'hello2')
        .then(() => {
          const value = db.get('key1')
          assert.equal(value, 'hello2')
        })
    })

    it('put updates a value', () => {
      return db.put('key1', 'hello3')
        .then(() => db.put('key1', 'hello4'))
        .then(() => {
          const value = db.get('key1')
          assert.equal(value, 'hello4')
        })
    })

    it('set is an alias for put', () => {
      return db.set('key1', 'hello5')
        .then(() => {
          const value = db.get('key1')
          assert.equal(value, 'hello5')
        })
    })

    it('put/get - multiple keys', () => {
      return db.put('key1', 'hello1')
        .then(() => db.put('key2', 'hello2'))
        .then(() => db.put('key3', 'hello3'))
        .then(() => {
          const v1 = db.get('key1')
          const v2 = db.get('key2')
          const v3 = db.get('key3')
          assert.equal(v1, 'hello1')
          assert.equal(v2, 'hello2')
          assert.equal(v3, 'hello3')
        })
    })

    it('deletes a key', () => {
      return db.put('key1', 'hello!')
        .then(() => db.del('key1'))
        .then(() => {
          const value = db.get('key1')
          assert.equal(value, null)
        })
    })

    it('deletes a key after multiple updates', () => {
      return db.put('key1', 'hello1')
        .then(() => db.put('key1', 'hello2'))
        .then(() => db.put('key1', 'hello3'))
        .then(() => db.del('key1'))
        .then(() => {
          const value = db.get('key1')
          assert.equal(value, null)
        })
    })

    it('get - integer value', () => {
      const val = 123
      return db.put('key1', val)
        .then(() => {
          const v1 = db.get('key1')
          assert.equal(v1, val)
        })
    })

    it('get - object value', () => {
      const val = { one: 'first', two: 2 }
      return db.put('key1', val)
        .then(() => {
          const v1 = db.get('key1')
          assert.deepEqual(v1, val)
        })
    })

    it('get - array value', () => {
      const val = [1, 2, 3, 4, 5]
      return db.put('key1', val)
        .then(() => {
          const v1 = db.get('key1')
          assert.deepEqual(v1, val)
        })
    })

    describe('sync', () => {
      const options = { 
        replicate: false, 
        maxHistory: 0 
      }

      it('syncs databases', (done) => {
        const db2 = client2.kvstore(config.dbname, options)
        db2.events.on('write', (dbname, hash) => {
          assert.equal(db.get('key1'), null)

          db.sync(hash)
            .then((hash) => {
              const value = db.get('key1')
              assert.equal(value, 'hello2')
              done()
            })
            .catch(done)
        })
        db2.put('key1', 'hello2')
      })

      it('sync returns the updated log\'s hash', (done) => {
        let firstHash, secondHash
        const db2 = client2.kvstore(config.dbname, options)
        db2.events.on('write', (dbname, hash) => {
          db.sync(hash)
            .then((hash) => {
              const value1 = db.get('key1')
              const value2 = db.get('key2')
              assert.equal(value1, 'hello1')
              assert.equal(value2, 'hello2')
              assert.notEqual(firstHash, hash)
              done()
            })
            .catch(done)
        })
        db.events.on('write', (dbname, hash) => {
          firstHash = hash
          db2.put('key2', 'hello2')
        })
        db.put('key1', 'hello1')
      })
    })
  })
})
