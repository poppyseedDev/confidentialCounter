import { useEffect, useState } from 'react';
import { getInstance } from '../../fhevmjs.ts';
import './Devnet.css';
import { Eip1193Provider, Provider, ZeroAddress } from 'ethers';
import { ethers } from 'ethers';

import { reencryptEuint8 } from '../../../../hardhat/test/reencrypt.ts';

const toHexString = (bytes: Uint8Array) =>
  '0x' +
  bytes.reduce((str, byte) => str + byte.toString(16).padStart(2, '0'), '');

export type DevnetProps = {
  account: string;
  provider: Eip1193Provider;
  readOnlyProvider: Provider;
};

export const ConfCounter = ({
  account,
  provider,
  readOnlyProvider,
}: DevnetProps) => {
  const [contractAddress, setContractAddress] = useState(ZeroAddress);

  const [handleBalance, setHandleBalance] = useState('0');
  const [decryptedBalance, setDecryptedBalance] = useState('???');

  const [handles, setHandles] = useState<Uint8Array[]>([]);
  const [encryption, setEncryption] = useState<Uint8Array>();

  const [inputValue, setInputValue] = useState(''); // Track the input
  const [chosenValue, setChosenValue] = useState('0'); // Track the confirmed value

  const [isTransacting, setIsTransacting] = useState(false);

  useEffect(() => {
    const loadData = async () => {
      try {
        // Conditional import based on MOCKED environment variable
        let EncryptedCounter4;
        if (!import.meta.env.MOCKED) {
          EncryptedCounter4 = await import(
            '@deployments/sepolia/EncryptedCounter4.json'
          );
          console.log(
            `Using ${EncryptedCounter4.address} for the token address on Sepolia`,
          );
        } else {
          EncryptedCounter4 = await import(
            '@deployments/localhost/EncryptedCounter4.json'
          );
          console.log(
            `Using ${EncryptedCounter4.address} for the token address on Hardhat Local Node`,
          );
        }

        setContractAddress(EncryptedCounter4.address);
      } catch (error) {
        console.error(
          'Error loading data - you probably forgot to deploy the token contract before running the front-end server:',
          error,
        );
      }
    };

    void loadData();
  }, []);

  const handleConfirmAmount = () => {
    setChosenValue(inputValue);
  };

  const instance = getInstance();

  const getHandleBalance = async () => {
    if (contractAddress != ZeroAddress) {
      const contract = new ethers.Contract(
        contractAddress,
        ['function getCounter(address user) view returns (uint256)'],
        readOnlyProvider,
      );
      const handleBalance = await contract.getCounter(account);
      setHandleBalance(handleBalance.toString());
      setDecryptedBalance('???');
    }
  };

  useEffect(() => {
    void getHandleBalance();
  }, [account, provider, contractAddress]);

  const encrypt = async (val: bigint) => {
    const now = Date.now();
    try {
      // Check if instance is properly initialized
      if (!instance) {
        throw new Error('FHEVMJS instance not initialized');
      }

      // Log the input parameters for debugging
      console.log('Encrypting value:', val.toString());
      console.log('Contract address:', contractAddress);
      console.log('Account:', account);

      const encryptedInput = instance.createEncryptedInput(contractAddress, account);
      if (!encryptedInput) {
        throw new Error('Failed to create encrypted input');
      }

      const result = await encryptedInput.add8(val).encrypt();
      console.log(`Encryption successful. Took ${(Date.now() - now) / 1000}s`);
      setHandles(result.handles);
      setEncryption(result.inputProof);
    } catch (e) {
      console.error('Detailed encryption error:', e);
      // Add more specific error handling
      if (e instanceof TypeError && e.message.includes('Failed to fetch')) {
        console.error('Network error - please check your connection to the TFHE service');
      }
      console.log('Time elapsed:', (Date.now() - now) / 1000, 's');
    }
  };

  const decrypt = async () => {
    try {
      const signer = await provider.getSigner();
      if (!signer) throw new Error('Failed to get signer');
      
      const clearBalance = await reencryptEuint8(
        signer,
        instance,
        BigInt(handleBalance),
        contractAddress,
      );
      setDecryptedBalance(clearBalance.toString());
    } catch (error) {
      if (error === 'Handle is not initialized') {
        setDecryptedBalance('0');
      } else {
        console.error('Decryption error:', error);
        setDecryptedBalance('Error');
      }
    }
  };

  const transferToken = async () => {
    if (isTransacting) return; // Prevent multiple simultaneous transactions
    setIsTransacting(true);
    
    try {
      // Ensure provider is ready
      if (!provider) throw new Error('Provider not available');
      
      const signer = await provider.getSigner();
      if (!signer) throw new Error('Failed to get signer');

      // Create contract instance with the signer directly
      const contract = new ethers.Contract(
        contractAddress,
        ['function incrementBy(bytes32,bytes) external'],
        signer // Use signer instead of provider here
      );
      
      const tx = await contract.incrementBy(
        toHexString(handles[0]),
        toHexString(encryption),
      );
      
      // Wait for transaction with timeout
      const receipt = await Promise.race([
        tx.wait(),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Transaction timeout')), 60000)
        )
      ]);

      console.log('Transaction completed:', receipt);
      await getHandleBalance();
    } catch (error) {
      console.error('Transfer error:', error);
      // Add user feedback here
    } finally {
      setIsTransacting(false);
    }
  };

  return (
    <div>
      <dl>
        <dt className="Devnet__title">Current encrypted counter value:</dt>
        <dd className="Devnet__dd">{handleBalance.toString()}</dd>

        <button onClick={() => decrypt()}>
          Reencrypt and decrypt counter value
        </button>
        <dd className="Devnet__dd">
          Decrypted counter value is: {decryptedBalance.toString()}
        </dd>

        <dd className="Devnet__dd">Choose an amount to increment by:</dd>

        <div>
          <input
            type="number"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            placeholder="Enter a number"
          />{' '}
          <button onClick={handleConfirmAmount}>OK</button>
          {chosenValue !== null && (
            <div>
              <p>You chose: {chosenValue}</p>
            </div>
          )}
        </div>

        <button onClick={() => encrypt(BigInt(chosenValue))}>
          Encrypt {chosenValue}
        </button>
        <dt className="Devnet__title">
          This is an encryption of {chosenValue}:
        </dt>
        <dd className="Devnet__dd">
          <pre className="Devnet__pre">
            Handle: {handles.length ? toHexString(handles[0]) : ''}
          </pre>
          <pre className="Devnet__pre">
            Input Proof: {encryption ? toHexString(encryption) : ''}
          </pre>
        </dd>

        <div>
          {encryption && encryption.length > 0 && (
            <button onClick={transferToken}>
              Increment Counter by Encrypted Amount
            </button>
          )}
        </div>

      </dl>
    </div>
  );
};
