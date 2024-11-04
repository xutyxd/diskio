import child_process, { execSync } from 'node:child_process';
import { existsSync, mkdirSync, statSync, truncateSync, writeFileSync } from 'node:fs';
import { FileHandle, mkdir, readdir, rmdir, stat, truncate, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { exists } from '../common/fs-extends';
import { IDiskIO } from '../interfaces/diskio.interface';
import { DiskIOFile } from './diskio-file.class';

const exec = promisify(child_process.exec);

export class DiskIO implements IDiskIO {
    private RESERVED_FILE = 'diskio.dat';
    private RESERVED_SIZE;
    private path: { folder: string, diskio: string };
    private optimal = 4096;

    public get folder() {
        return this.path.folder;
    }

    public ready: Promise<void>;

    constructor(path: string, size: number) {
        // Check if the path exists
        if (!existsSync(path)) {
            throw new Error('The path does not exist');
        }
        // Check if the path is a valid directory
        const isDirectory = statSync(path).isDirectory();
        if (!isDirectory) {
            throw new Error('The path is not a directory');
        }
        // Check if the size is a valid number
        if (typeof size !== 'number') {
            throw new Error('The size is not a number');
        }
        // Check if the size is positive
        if (size <= 0) {
            throw new Error('The size must be positive');
        }
        this.RESERVED_SIZE = size;
        // Set paths
        this.path = {
            folder: join(path),
            diskio: `${join(path)}/${this.RESERVED_FILE}`
        };
        // Stabilize the diskio space
        this.ready = new Promise(async (resolve) => {
            await this.stabilize(size);
            this.optimal = await this.size.block();
            resolve();
        });
    }

    private size = {
        block: async () => {
            const { stdout } = await exec(`stat -f -c "%S" ${this.path.folder}`);
            return Number(stdout);
        },
        diskio: async () => {
            const status = await stat(this.path.diskio);
            // Get diskio file size
            const { size } = status;

            return size;
        },
        diskioSync: () => {
            const status = statSync(this.path.diskio);
            // Get diskio file size
            const { size } = status;

            return size;
        },
        folder: async () => {
            const { stdout } = await exec(`du -sb ${this.path.folder}`);
            const cleaned = stdout.split('\t');
            const [ size ] = cleaned;

            return Number(size);
        },
        folderSync: () => {
            const buffer = execSync(`du -sb ${this.path.folder}`);
            const stdout = buffer.toString();
            const cleaned = stdout.split('\t');
            const [ size ] = cleaned;

            return Number(size);
        }
    }

    public information = {
        disk: async () => {
            const { stdout } = await exec(`df -k ${this.path.folder}`)
            const [, information] = stdout.split('\n');
            const cleaned = information.replace(/ +/g, ' ');
            const [ filesystem, size, used, available, capacity, mount ] = cleaned.split(' ');
    
            return {
                filesystem,
                size: Number(size),
                used: Number(used),
                available: Number(available),
                capacity,
                mount
            };
        },
        diskio: async () => {
            // Get diskio file size - optimal block size, one is reserved for folder metadata
            const size = this.RESERVED_SIZE - this.optimal;
            const available = await this.size.diskio();
            const used = await this.size.folder() - available;
            const capacity = Math.round(100 - (used / size) * 100);

            return {
                size, // in bytes
                used, // in bytes
                available, // in bytes
                capacity: `${capacity}%`, // in percentage
            };
        }
    }

    private async stabilize(expected: number) {
        const diskioExists = await exists(this.path.diskio);
        // Check if diskio file exists
        if (!diskioExists) {
            // Create diskio file
            await writeFile(this.path.diskio, Buffer.alloc(0));
        }
        const diskio = await this.size.diskio();
        const folder = await this.size.folder();
        const difference = expected - folder + diskio;
        // Truncate the difference
        await truncate(this.path.diskio, difference);
    }

    private stabilizeSync(expected: number) {
        const diskioExists = existsSync(this.path.diskio);
        // Check if diskio file exists
        if (!diskioExists) {
            // Create diskio file
            writeFileSync(this.path.diskio, Buffer.alloc(0));
        }
        const diskio = this.size.diskioSync();
        const folder = this.size.folderSync();
        const difference = expected - folder + diskio;
        // Truncate the difference
        truncateSync(this.path.diskio, difference);
    }

    private async allocate(size: number) {
        const diskio = await this.size.diskio();
        // Check if the size is less than the available size
        if (size > diskio) {
            throw new Error('The size is greater than the available size');
        }

        // Truncate the difference
        await truncate(this.path.diskio, diskio - size);
    }

    public async create(name: string): Promise<DiskIOFile> {
        // Check if the name is a valid string
        if (typeof name !== 'string') {
            throw new Error('The name is not a string');
        }
        // Check if the name is empty
        if (name.length === 0) {
            throw new Error('The name is empty');
        }
        // Get a random UUID
        const uuid = crypto.randomUUID();
        // Create path for the file
        const path = join(this.path.folder, ...uuid.split('-'));
        // Folders required to create the file
        await mkdir(path, { recursive: true });
        // Create file path
        const filePath = join(path, name);
        // Check if file exists
        if (await exists(filePath)) {
            // Recall trying to get a new path without the file
            return this.create(name);
        }
        // Create the file
        await writeFile(filePath, Buffer.alloc(0));
        // Update the diskio file (folder metadata have size)
        await this.stabilize(this.RESERVED_SIZE);
        // Return the file
        return this.get(filePath.replace(this.path.folder, ''));
    }

    public createSync(name: string): DiskIOFile {
         // Check if the name is a valid string
         if (typeof name !== 'string') {
            throw new Error('The name is not a string');
        }
        // Check if the name is empty
        if (name.length === 0) {
            throw new Error('The name is empty');
        }
        // Get a random UUID
        const uuid = crypto.randomUUID();
        // Create path for the file
        const path = join(this.path.folder, ...uuid.split('-'));
        // Folders required to create the file
        mkdirSync(path, { recursive: true });
        // Create file path
        const filePath = join(path, name);
        // Check if file exists
        if (existsSync(filePath)) {
            // Recall trying to get a new path without the file
            return this.createSync(name);
        }
        // Create the file
        writeFileSync(filePath, Buffer.alloc(0));
        // Update the diskio file (folder metadata have size)
        this.stabilizeSync(this.RESERVED_SIZE);
        // Return the file
        return this.getSync(filePath.replace(this.path.folder, ''));
    }

    public async get(name: string): Promise<DiskIOFile> {
        // Clean the name
        const cleaned = name.split('/').filter(Boolean);
        // Get the path
        const path = join(this.path.folder, ...cleaned);
        // Check that name is not diskio file
        if (path === this.path.diskio) {
            throw new Error('The name is diskio storage file');
        }
        // Get an instance of the file
        const diskioFile = new DiskIOFile(this, cleaned);
        // Wait for the file to be ready
        await diskioFile.ready;
        // Return the file
        return diskioFile;
    }

    public getSync(name: string): DiskIOFile {
        // Clean the name
        const cleaned = name.split('/').filter(Boolean);
        // Get the path
        const path = join(this.path.folder, ...cleaned);
        // Check that name is not diskio file
        if (path === this.path.diskio) {
            throw new Error('The name is diskio storage file');
        }
        // Get an instance of the file
        const diskioFile = new DiskIOFile(this, cleaned);
        // Return the file
        return diskioFile;
    }

    public async read(fh: FileHandle, start: number, end: number): Promise<Buffer> {
        // Get difference between the expected size and the available size
        const difference = end - start;
        // Get file size
        const { size } = await fh.stat();
        // Create a buffer to read
        const buffer = Buffer.alloc(end - start);
        // Calculate how many reads are needed
        let reads = Math.ceil(difference / this.optimal);
        // Set index to 0
        let index = 0;
        // Iterate over the blobs
        while (index < reads) {
            // Calculate the buffer start position
            const bufferStart = start + index * this.optimal;
            // Calculate how many bytes to read
            const bytesToRead = bufferStart + this.optimal > size ? size - bufferStart : this.optimal;
            // Read the buffer
            await fh.read(buffer, bufferStart, bytesToRead, bufferStart);
            // Increment the index
            index++;
        }

        return buffer;
    }

    public async write(fh: FileHandle, data: Buffer, position: number) {
        // First, allocate the space
        await this.allocate(data.length);
        // Calculate how many writes are needed
        let writes = Math.ceil(data.length / this.optimal);
        // Set index to 0
        let index = 0;
        // Iterate over the blobs
        while (index < writes) {
            // Calculate the buffer start position
            const bufferStart = position + index * this.optimal;
            // Calculate how many bytes to write
            // const bytesToWrite = bufferStart + this.optimal > size ? size - bufferStart : this.optimal;
            const bytesToWrite = this.optimal > data.length - bufferStart ? data.length - bufferStart : this.optimal;
            // Write the buffer
            await fh.write(data, bufferStart, bytesToWrite, bufferStart);
            // Increment the index
            index++;
        }
    }

    public async delete(fh: FileHandle, name: string[]) {
        // Close the file handle
        await fh.close();
        const path = join(this.path.folder, ...name);
        // Delete the file
        await unlink(join(path));
        let copy = [ ...name ];
        // Remove last element until get undefined
        while (copy.pop()) {
            // Get folder path
            const parent = join(this.path.folder, ...copy);
            // Check if folder parent is empty
            const readed = await readdir(parent);
            if (readed.length !== 0) {
                // If have files or folders, stop
                break;
            }
            // Delete the folder
            await rmdir(parent);
        }
        
        // Update the diskio file
        await this.stabilize(this.RESERVED_SIZE);
    }
}