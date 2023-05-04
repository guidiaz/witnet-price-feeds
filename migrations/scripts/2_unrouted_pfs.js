const fs = require("fs")
const { merge } = require("lodash")
const utils = require("../../scripts/utils")

const addresses = require("../addresses")
const queries = require("../witnet-queries")
const settings = require("../settings")

const WitnetPriceFeeds = artifacts.require("WitnetPriceFeeds");
const WitnetPriceRouter = artifacts.require("WitnetPriceRouter")
const WitnetRequestBoard = artifacts.require("WitnetRequestBoard")

module.exports = async function (deployer, network, [, from]) {
  const [realm, chain] = utils.getRealmNetworkFromString(network.split("-")[0])
  if (chain !== "test" && chain.split(".")[1] !== "test") {
    await revisitPriceFeeds(deployer, from, realm, chain, network.split("-")[1] === "fork")
  }
  else {
    if (realm !== "default") {
      if (
        !settings.networks[realm] ||
        !settings.networks[realm][chain] ||
        !settings.networks[realm][chain] ||
        settings.networks[realm][chain].network_id == 4447
      ) {
        console.error(`\nFatal: no "test" configuration found for ${realm.toUpperCase()} realm! Please, review network settings.`)
        process.exit(1)
      }
      let answer = (await utils.prompt(`> Do you really want to run tests against ${realm.toUpperCase()} realm? [y/N] `)).toLowerCase().trim()
      if (!["y", "yes"].includes(answer)) {
        console.log("\nInfo: cancelled by user.")
        process.exit(0)
      } else {
        console.log("> As you wish. Please, be patient...")
      }
    }
  }
}

async function revisitPriceFeeds (deployer, from, realm, chain, isDryRun) {

  var updateAll = false
  process.argv.map((argv) => {
    if (argv === "--update-all") {
      updateAll = true
    }
  })

  if (!addresses[realm]) addresses[realm] = {}
  if (!addresses[realm][chain]) addresses[realm][chain] = {}

  const artifactNames = merge(
    settings.artifacts.default,
    settings.artifacts[realm],
    settings.artifacts[chain],
  )
  
  let WitnetPriceFeed = artifacts.require(artifactNames.WitnetPriceFeed)
  const bypass = artifactNames.WitnetPriceFeed === "WitnetPriceFeedBypass"
  const pfs = Object.keys(queries)
  for (let i = 0; i < pfs.length; i++) {
    const pf_name = pfs[i]
    const pf = queries[pf_name]
    WitnetPriceFeed.contractName = pf_name + "Feed"
    if (addresses[realm][chain][WitnetPriceFeed.contractName] !== undefined) {
      const address = addresses[realm][chain][WitnetPriceFeed.contractName]
      // Ignore routed price feeds, by now
      if (!pf.bytecode && !bypass) {
        continue
      }
      if (!pf.decimals) {
        console.error(`Error: no decimals specified for '${pf_name}' in 'migrations/witnet-queries.json'`)
        return
      }
      if (!pf.base) {
        console.error(`Error: no base specified for '${pf_name}' in 'migrations/witnet-queries.json'`)
        return
      }
      if (!pf.quote) {
        console.error(`Error: no quote specified for '${pf_name}' in 'migrations/addresses.json'`)
        return
      }
      const caption = "Price-" + pf.base + "/" + pf.quote + "-" + pf.decimals
      // Deploy new contract if it still has no corresponding entry in the 'migrations/addresses.json' file:
      if (utils.isNullAddress(address)) {
        if (bypass) {
          // Continue only if this is an unrouted price feed
          await deployer.deploy(
            WitnetPriceFeed,
            WitnetPriceFeeds.address,
            caption, 
            { from }
          )
        } else {
          // Continue only if this is an unrouted price feed
          await deployer.deploy(
            WitnetPriceFeed,
            WitnetRequestBoard.address,
            pf.bytecode, 
            { from }
          )
        }
        // Write new contract address into 'migrations/addresses.json'
        console.log("   > Artifact name:\t  \"" + artifactNames.WitnetPriceFeed + "\"")
        console.log("   > Contract name:\t  \"" + WitnetPriceFeed.contractName + "\"")
        addresses[realm][chain][WitnetPriceFeed.contractName] = WitnetPriceFeed.address
        if (!isDryRun) {
          fs.writeFileSync(
            "./migrations/addresses.json",
            JSON.stringify(addresses, null, 4),
            { flag: 'w+'}
          )
        }
      }
      // Otherwise, just update the local artifact file:
      else {
        WitnetPriceFeed.address = address
        const header = `Skipped '${WitnetPriceFeed.contractName}'`
        console.log("\n  ", header)
        console.log("  ", "-".repeat(header.length))
        console.log("   > contract address:\t", address)
      }

      // Update Price Router if necessary:
      var router = await WitnetPriceRouter.deployed()
      const erc2362id = await router.currencyPairId.call(caption)
      console.log("\n   > ERC2362 caption:\t ", caption)
      console.log("   > ERC2362 id:     \t ", erc2362id)
      console.log("   > Router address:\t ", router.address)
      let currentPoller = await router.getPriceFeed(erc2362id)
      if (!isDryRun && (utils.isNullAddress(currentPoller) || currentPoller !== WitnetPriceFeed.address)) {
        let answer = updateAll === true
          ? "yes"
          : (await utils.prompt(`     ? Substitute current pricefeed at ${currentPoller}? [y/N] `)).toLowerCase().trim()
        if (["y", "yes"].includes(answer)) {
          await router.setPriceFeed(
            WitnetPriceFeed.address,
            pf.decimals,
            pf.base,
            pf.quote,
            { from }
          )
          console.log("     > Done.")
        }
      }

      // Try to get Witnet general info, if any (contract may not actually be a WitnetPriceFeed implementation)
      let contract = await WitnetPriceFeed.at(WitnetPriceFeed.address)
      try {
        console.log("\n   > Witnet address:\t ", await contract.witnet.call())
        console.log("   > Witnet Request hash:", await contract.hash.call())
      } catch {}
    }
  }
  console.log()
  if (bypass) {
    process.exit(0)
  }
}
