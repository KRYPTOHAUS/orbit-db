'use strict'

const assert = require('assert')
const mapSeries = require('p-each-series')
const rmrf = require('rimraf')
const hasIpfsApiWithPubsub = require('./test-utils').hasIpfsApiWithPubsub
const OrbitDB = require('../src/OrbitDB')
const config = require('./test-config')

// Daemon settings
const daemonsConf = require('./ipfs-daemons.conf.js')

// Shared database name
const waitForPeers = (ipfs, channel) => {
  return new Promise((resolve, reject) => {
    console.log("Waiting for peers...")
    const interval = setInterval(() => {
      ipfs.pubsub.peers(channel)
        .then((peers) => {
          if (peers.length > 0) {
            console.log("Found peers, running tests...")
            clearInterval(interval)
            resolve()
          }
        })
        .catch((e) => {
          clearInterval(interval)
          reject(e)
        })
    }, 1000)
  })
}

config.daemons.forEach((IpfsDaemon) => {

  describe('orbit-db - Replication', function() {
    this.timeout(config.timeout)

    let ipfs1, ipfs2, client1, client2, db1, db2

    const removeDirectories = () => {
      rmrf.sync(daemonsConf.daemon1.IpfsDataDir)
      rmrf.sync(daemonsConf.daemon2.IpfsDataDir)
      rmrf.sync(config.defaultIpfsDirectory)
      rmrf.sync(config.defaultOrbitDBDirectory)
    }

    before(function (done) {
      removeDirectories()
      ipfs1 = new IpfsDaemon(daemonsConf.daemon1)
      ipfs1.on('error', done)
      ipfs1.on('ready', () => {
        assert.equal(hasIpfsApiWithPubsub(ipfs1), true)
        ipfs2 = new IpfsDaemon(daemonsConf.daemon2)
        ipfs2.on('error', done)
        ipfs2.on('ready', () => {
          assert.equal(hasIpfsApiWithPubsub(ipfs2), true)
          client1 = new OrbitDB(ipfs1, "one")
          client2 = new OrbitDB(ipfs2, "two")
          done()
        })
      })
    })

    after(() => {
      ipfs1.stop()
      ipfs2.stop()
      removeDirectories()
    })

    describe('two peers', function() {
      beforeEach(() => {
        db1 = client1.eventlog(config.dbname, { maxHistory: 1, cachePath: '/tmp/daemon1' })
        db2 = client2.eventlog(config.dbname, { maxHistory: 1, cachePath: '/tmp/daemon2' })
      })

      it('replicates database of 1 entry', (done) => {
        waitForPeers(ipfs1, config.dbname)
          .then(() => {
            db2.events.once('error', done)
            db2.events.once('synced', (db) => {
              const items = db2.iterator().collect()
              assert.equal(items.length, 1)
              assert.equal(items[0].payload.value, 'hello')
              done()
            })
            db1.add('hello')
          })
          .catch(done)
      })

      it('replicates database of 100 entries', (done) => {
        const entryCount = 100
        const entryArr = []

        for (let i = 0; i < entryCount; i ++)
          entryArr.push(i)

        waitForPeers(ipfs1, config.dbname)
          .then(() => {
            let count = 0
            db2.events.once('error', done)
            db1.events.on('write', (d) => {
              count ++
              if (count === entryCount) {
                const timer = setInterval(() => {
                  const items = db2.iterator({ limit: -1 }).collect()
                  if (items.length === count) {
                    clearInterval(timer)
                    assert.equal(items.length, entryCount)
                    assert.equal(items[0].payload.value, 'hello0')
                    assert.equal(items[items.length - 1].payload.value, 'hello99')
                    done()
                  }
                }, 1000)
              }
            })

            mapSeries(entryArr, (i) => db1.add('hello' + i))
          })
          .catch(done)
      })
    })
  })
})
